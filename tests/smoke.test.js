const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('health check endpoint responds successfully with hardened security headers', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.ok(response.headers['content-security-policy']);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('uploaded files are not publicly exposed', async () => {
  const response = await request(app).get('/uploads/demo.txt');
  assert.equal(response.status, 404);
});

test('protected routes reject unauthenticated requests with 401', async () => {
  const response = await request(app).get('/api/assets');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'UnauthorizedError');
});

test('requirement catalog endpoint is mounted and protected', async () => {
  const response = await request(app).get('/api/requirements');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'UnauthorizedError');
});

test('new dynamic module endpoints are mounted and protected', async () => {
  for (const path of ['/api/components', '/api/kits', '/api/eulas', '/api/import/assets', '/api/calendar/events', '/api/notifications']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 401, `${path} should require authentication`);
    assert.equal(response.body.error, 'UnauthorizedError');
  }
});

test('user records retain assigned menu access permissions', async () => {
  const User = require('../models/User');
  const user = new User({
    name: 'Menu Access User',
    email: 'menu.access@example.com',
    password: 'Password123',
    role: 'admin',
    menuAccess: ['assets', 'maintenance', 'reports'],
  });

  assert.deepEqual(user.menuAccess, ['assets', 'maintenance', 'reports']);
  assert.ok(User.schema.path('menuAccess'));
});

test('login cookie is scoped to the app root so protected API calls keep working', async () => {
  const User = require('../models/User');
  const AuditLog = require('../models/AuditLog');
  const authController = require('../controllers/authController');

  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

  const originalFindOne = User.findOne;
  const originalCreate = AuditLog.create;
  const email = 'cookie.scope@example.com';
  const password = 'Pass12345';

  const user = {
    _id: 'user-1',
    email,
    active: true,
    role: 'superadmin',
    refreshTokenVersion: 1,
    comparePassword: async () => true,
    toSafeJSON: () => ({ id: 'user-1', email, role: 'superadmin' }),
    save: async () => {},
  };

  user.select = async () => user;
  User.findOne = () => ({ select: async () => user });
  AuditLog.create = async () => ({ ok: true });

  const cookies = [];
  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    },
    json(payload) {
      this.payload = payload;
    },
  };

  try {
    await authController.login({ body: { email, password }, headers: {} }, res, () => {});
  } finally {
    User.findOne = originalFindOne;
    AuditLog.create = originalCreate;
  }

  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, 'refresh_token');
  assert.equal(cookies[0].options.path, '/');
  assert.equal(cookies[0].options.sameSite, 'lax');
  assert.ok(res.payload.accessToken);
  assert.equal(res.payload.user.email, email);
});

test('invalid refresh tokens clear the stale refresh cookie', async () => {
  const response = await request(app)
    .post('/api/auth/refresh')
    .set('Cookie', 'refresh_token=stale-token');

  assert.equal(response.status, 401);
  assert.ok(response.headers['set-cookie']?.some((cookie) => cookie.startsWith('refresh_token=;')));
});

test('logout clears a stale session without requiring an access token', async () => {
  const response = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', 'refresh_token=stale-token');

  assert.equal(response.status, 204);
  assert.ok(response.headers['set-cookie']?.some((cookie) => cookie.startsWith('refresh_token=;')));
});

test('user list supports deleted, active, role, and search filters together', async () => {
  const User = require('../models/User');
  const controller = require('../controllers/userAdminController');
  const originalFind = User.find;
  const seen = [];

  User.find = (filter) => {
    seen.push(filter);
    return {
      sort: async () => [],
    };
  };

  try {
    await controller.list(
      { query: { deleted: 'true', active: 'false', role: 'admin', search: 'sam' } },
      { json: () => {} },
      () => {}
    );

    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], {
      deletedAt: { $ne: null },
      active: false,
      role: 'admin',
      $or: [
        { name: { $regex: 'sam', $options: 'i' } },
        { email: { $regex: 'sam', $options: 'i' } },
      ],
    });
  } finally {
    User.find = originalFind;
  }
});

test('resource modules support dynamic filters and search across key fields', async () => {
  const Component = require('../models/Component');
  const Kit = require('../models/Kit');
  const componentController = require('../controllers/componentController');
  const kitController = require('../controllers/kitController');

  const originalComponentFind = Component.find;
  const originalComponentCount = Component.countDocuments;
  const originalKitFind = Kit.find;
  const originalKitCount = Kit.countDocuments;

  let componentFilter = null;
  let kitFilter = null;

  Component.find = (filter) => {
    componentFilter = filter;
    return {
      populate: () => ({
        sort: () => ({
          skip: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
  };
  Component.countDocuments = async (filter) => {
    componentFilter = filter;
    return 0;
  };
  Kit.find = (filter) => {
    kitFilter = filter;
    return {
      populate: () => ({
        sort: () => ({
          skip: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
  };
  Kit.countDocuments = async (filter) => {
    kitFilter = filter;
    return 0;
  };

  try {
    await componentController.list(
      { query: { category: 'Laptop', status: 'available', search: 'x1', page: '1', limit: '20' } },
      { json: () => {} },
      () => {}
    );

    await kitController.list(
      { query: { category: 'Office Setup', active: 'true', search: 'starter', page: '1', limit: '20' } },
      { json: () => {} },
      () => {}
    );

    assert.deepEqual(componentFilter, {
      category: 'Laptop',
      status: 'available',
      $or: [
        { name: { $regex: 'x1', $options: 'i' } },
        { category: { $regex: 'x1', $options: 'i' } },
        { manufacturer: { $regex: 'x1', $options: 'i' } },
        { modelNumber: { $regex: 'x1', $options: 'i' } },
        { serialNumber: { $regex: 'x1', $options: 'i' } },
      ],
    });

    assert.deepEqual(kitFilter, {
      category: 'Office Setup',
      active: true,
      $or: [
        { name: { $regex: 'starter', $options: 'i' } },
        { category: { $regex: 'starter', $options: 'i' } },
        { description: { $regex: 'starter', $options: 'i' } },
      ],
    });
  } finally {
    Component.find = originalComponentFind;
    Component.countDocuments = originalComponentCount;
    Kit.find = originalKitFind;
    Kit.countDocuments = originalKitCount;
  }
});

test('scan tag responses avoid leaking sensitive asset details', async () => {
  const assetController = require('../controllers/assetController');
  const Asset = require('../models/Asset');
  const originalFindOne = Asset.findOne;

  const assetDocument = {
    _id: 'asset-123',
    assetTag: 'AST-000001',
    name: 'Laptop',
    category: 'Laptop',
    status: 'assigned',
    location: 'HQ / Floor 2',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    currentAssignment: {
      _id: 'assign-1',
      status: 'assigned',
      dueDate: new Date('2024-02-15'),
      checkoutDate: new Date('2024-01-05'),
      assignedTo: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        department: 'IT',
      },
    },
    qrCode: 'super-secret-qr-data',
    documents: [{ label: 'invoice', fileName: 'invoice.pdf' }],
    notes: 'private notes',
    purchaseCost: 1500,
  };

  Asset.findOne = () => ({
    populate: () => assetDocument,
  });

  try {
    let responsePayload;
    await new Promise((resolve, reject) => {
      assetController.getByTag(
        { params: { tag: 'AST-000001' } },
        { json: (payload) => {
          responsePayload = payload;
          resolve();
        } },
        (error) => reject(error)
      );
    });

    assert.equal(responsePayload.asset.assetTag, 'AST-000001');
    assert.equal(responsePayload.asset.name, 'Laptop');
    assert.equal(responsePayload.asset.currentAssignment.assignedTo.email, undefined);
    assert.equal(responsePayload.asset.qrCode, undefined);
    assert.equal(responsePayload.asset.documents, undefined);
    assert.equal(responsePayload.asset.purchaseCost, undefined);
    assert.equal(responsePayload.asset.notes, undefined);
    assert.equal(responsePayload.asset.currentAssignment.assignedTo.name, 'Jane Doe');
  } finally {
    Asset.findOne = originalFindOne;
  }
});
