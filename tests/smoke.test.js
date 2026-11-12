const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const { loginSchema } = require('../utils/schemas');

test('login validation accepts null institution selections', () => {
  const parsed = loginSchema.safeParse({
    email: 'user@example.com',
    password: 'Password123',
    institutionId: null,
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.institutionId, null);
});

test('user creation schema validates the initial password and account fields', () => {
  const { createUserSchema } = require('../utils/schemas');
  assert.equal(createUserSchema.safeParse({
    name: '  Asset User  ',
    email: 'person@example.com',
    password: 'Password123',
  }).success, true);
  assert.equal(createUserSchema.safeParse({
    name: 'A',
    email: 'invalid',
    password: 'short',
  }).success, false);
  assert.equal(createUserSchema.safeParse({
    name: 'Asset User',
    email: 'person@example.com',
    password: 'Password123',
    role: 'owner',
  }).success, false);
});

test('new user creation attaches the active institution and membership', async () => {
  const User = require('../models/User');
  const Institution = require('../models/Institution');
  const controller = require('../controllers/userAdminController');
  const originalCreate = User.create;
  const originalExists = User.exists;
  const originalInstitutionExists = Institution.exists;
  const institutionId = '64f8ff7f2e7f6d0012345678';
  const seen = {};

  User.exists = async () => false;
  Institution.exists = async () => true;
  User.create = async (payload) => {
    seen.payload = payload;
    return {
      ...payload,
      _id: 'user-123',
      toSafeJSON: () => ({ id: 'user-123', ...payload }),
    };
  };

  const req = {
    body: {
      name: 'Institution User',
      email: 'institution.user@example.com',
      password: 'Password123',
      role: 'asset_user',
      institutionId: '64f8ff7f2e7f6d0012345679',
    },
    user: { role: 'admin', institution: { _id: institutionId } },
  };
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await controller.create(req, res, () => {});
  } finally {
    User.exists = originalExists;
    Institution.exists = originalInstitutionExists;
    User.create = originalCreate;
  }

  assert.ok(seen.payload);
  assert.equal(seen.payload.institution.toString(), institutionId);
  assert.deepEqual(seen.payload.institutions, [institutionId]);
  assert.equal(res.code, 201);
});

test('superadmin-created users are attached to the selected active institution', async () => {
  const User = require('../models/User');
  const Institution = require('../models/Institution');
  const controller = require('../controllers/userAdminController');
  const originalCreate = User.create;
  const originalExists = User.exists;
  const originalInstitutionExists = Institution.exists;
  const institutionId = '64f8ff7f2e7f6d0012345678';
  let created;
  let institutionQuery;

  User.exists = async () => false;
  Institution.exists = async (query) => {
    institutionQuery = query;
    return true;
  };
  User.create = async (payload) => {
    created = payload;
    return { ...payload, _id: 'new-user-id', toSafeJSON: () => ({ id: 'new-user-id', ...payload }) };
  };

  const res = {
    status(code) { this.code = code; return this; },
    json(payload) { this.body = payload; },
  };
  try {
    await controller.create(
      {
        body: {
          name: 'New Institution User',
          email: 'new.user@example.com',
          password: 'Password123',
          role: 'admin',
          institutionId,
        },
        user: { _id: 'superadmin-id', role: 'superadmin' },
        headers: {},
      },
      res,
      (error) => { throw error; }
    );
  } finally {
    User.exists = originalExists;
    User.create = originalCreate;
    Institution.exists = originalInstitutionExists;
  }

  assert.deepEqual(institutionQuery, { _id: institutionId, status: 'active' });
  assert.equal(created.institution, institutionId);
  assert.deepEqual(created.institutions, [institutionId]);
  assert.equal(res.code, 201);
});

test('superadmin cannot create an unassigned user or use an inactive institution', async () => {
  const User = require('../models/User');
  const Institution = require('../models/Institution');
  const controller = require('../controllers/userAdminController');
  const originalExists = User.exists;
  const originalInstitutionExists = Institution.exists;
  User.exists = async () => false;
  Institution.exists = async () => false;
  const req = {
    body: {
      name: 'Unassigned User',
      email: 'unassigned@example.com',
      password: 'Password123',
      role: 'asset_user',
    },
    user: { role: 'superadmin' },
  };
  const errors = [];

  try {
    await controller.create(req, {}, (error) => { errors.push(error); });
    await controller.create(
      { ...req, body: { ...req.body, institutionId: '64f8ff7f2e7f6d0012345678' } },
      {},
      (error) => { errors.push(error); }
    );
  } finally {
    User.exists = originalExists;
    Institution.exists = originalInstitutionExists;
  }

  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Select an institution/);
  assert.match(errors[1].message, /not active or does not exist/);
});

test('admins cannot create elevated user roles', async () => {
  const controller = require('../controllers/userAdminController');
  let forwardedError;
  await controller.create(
    {
      body: {
        name: 'New Admin',
        email: 'new.admin@example.com',
        password: 'Password123',
        role: 'admin',
      },
      user: { role: 'admin', institution: { _id: '64f8ff7f2e7f6d0012345678' } },
    },
    {},
    (error) => { forwardedError = error; }
  );

  assert.equal(forwardedError?.status, 403);
  assert.match(forwardedError?.message || '', /asset-user accounts only/);
});

test('institution-aware tenancy is available for users, assets, and catalog records', () => {
  const User = require('../models/User');
  const Asset = require('../models/Asset');
  const Institution = require('../models/Institution');
  const Accessory = require('../models/Accessory');
  const Consumable = require('../models/Consumable');
  const License = require('../models/License');
  const Component = require('../models/Component');
  const Kit = require('../models/Kit');
  const Eula = require('../models/Eula');
  const Assignment = require('../models/Assignment');
  const Maintenance = require('../models/Maintenance');
  const AssetRequest = require('../models/AssetRequest');

  assert.ok(User.schema.path('institution'));
  assert.ok(User.schema.path('institutions'));
  assert.ok(Asset.schema.path('institution'));
  assert.ok(Accessory.schema.path('institution'));
  assert.ok(Consumable.schema.path('institution'));
  assert.ok(License.schema.path('institution'));
  assert.ok(Component.schema.path('institution'));
  assert.ok(Kit.schema.path('institution'));
  assert.ok(Eula.schema.path('institution'));
  assert.ok(Assignment.schema.path('institution'));
  assert.ok(Maintenance.schema.path('institution'));
  assert.ok(AssetRequest.schema.path('institution'));
  assert.ok(Institution.schema.path('name'));
  assert.ok(Institution.schema.path('code'));
});

test('health check endpoint responds successfully with hardened security headers', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.ok(response.headers['x-request-id']);
  assert.ok(response.headers['content-security-policy']);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('readiness endpoint reports database disconnection', async () => {
  const mongoose = require('mongoose');
  assert.notEqual(mongoose.connection.readyState, 1);
  const response = await request(app).get('/api/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    status: 'not_ready',
    checks: { database: 'disconnected' },
  });
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

test('admin user list is scoped to its institution and combines search safely', async () => {
  const User = require('../models/User');
  const controller = require('../controllers/userAdminController');
  const originalFind = User.find;
  let seenFilter;

  User.find = (filter) => {
    seenFilter = filter;
    return {
      populate() {
        return {
          sort: async () => [],
        };
      },
    };
  };

  try {
    await controller.list(
      {
        query: { search: 'sam' },
        user: { role: 'admin', institution: { _id: '64f8ff7f2e7f6d0012345678' } },
      },
      { json: () => {} },
      (error) => { throw error; }
    );
  } finally {
    User.find = originalFind;
  }

  assert.deepEqual(seenFilter.$and, [
    { $or: [{ institution: '64f8ff7f2e7f6d0012345678' }, { institutions: '64f8ff7f2e7f6d0012345678' }] },
    { $or: [{ name: { $regex: 'sam', $options: 'i' } }, { email: { $regex: 'sam', $options: 'i' } }] },
  ]);
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
      { query: { category: 'Laptop', status: 'available', search: 'x1', page: '1', limit: '20' }, user: { role: 'superadmin' } },
      { json: () => {} },
      () => {}
    );

    await kitController.list(
      { query: { category: 'Office Setup', active: 'true', search: 'starter', page: '1', limit: '20' }, user: { role: 'superadmin' } },
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
        { params: { tag: 'AST-000001' }, user: { role: 'superadmin' } },
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

test('JWT secrets fail closed in production and must be distinct', () => {
  const { configureJwtSecrets } = require('../utils/jwtSecrets');

  assert.throws(
    () => configureJwtSecrets({ NODE_ENV: 'production' }),
    /Missing required env var: JWT_ACCESS_SECRET/
  );
  assert.throws(
    () => configureJwtSecrets({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'a'.repeat(64),
    }),
    /must be different/
  );
  assert.throws(
    () => configureJwtSecrets({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'short',
      JWT_REFRESH_SECRET: 'b'.repeat(64),
    }),
    /at least 32 characters/
  );
  assert.throws(
    () => configureJwtSecrets({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'replace_with_a_generated_secret_value',
      JWT_REFRESH_SECRET: 'b'.repeat(64),
    }),
    /must be replaced/
  );
});

test('tenant scopes fail closed when a non-superadmin has no active institution', () => {
  const { scopeInstitution, ensureInstitutionAccess } = require('../utils/institutionScope');

  assert.deepEqual(
    scopeInstitution({ user: { role: 'admin', institution: '64f8ff7f2e7f6d0012345678' } }, { status: 'available' }),
    { status: 'available', institution: '64f8ff7f2e7f6d0012345678' }
  );
  assert.throws(
    () => scopeInstitution({ user: { role: 'admin' } }, {}),
    (error) => error.status === 403
  );
  assert.equal(ensureInstitutionAccess({ user: { role: 'admin' } }, { institution: null }), false);
});

test('login cannot add an institution that is not already a user membership', async () => {
  const authController = require('../controllers/authController');
  const ownInstitutionId = '64f8ff7f2e7f6d0012345678';
  const otherInstitutionId = '64f8ff7f2e7f6d0098765432';
  const user = {
    role: 'admin',
    institution: ownInstitutionId,
    institutions: [ownInstitutionId],
  };

  await assert.rejects(
    authController._resolveUserInstitution(user, otherInstitutionId),
    (error) => error.status === 403
  );
  assert.equal(user.institution, ownInstitutionId);
  assert.deepEqual(user.institutions, [ownInstitutionId]);
});

test('login falls back from a stale current institution to a valid assigned institution', async () => {
  const Institution = require('../models/Institution');
  const authController = require('../controllers/authController');
  const originalFind = Institution.find;
  const staleInstitutionId = '64f8ff7f2e7f6d0012345678';
  const validInstitutionId = '64f8ff7f2e7f6d0098765432';
  const validInstitution = { _id: { toString: () => validInstitutionId }, name: 'Valid institution' };
  Institution.find = () => ({ lean: async () => [validInstitution] });

  const user = {
    role: 'admin',
    institution: staleInstitutionId,
    institutions: [staleInstitutionId, validInstitutionId],
  };

  try {
    const result = await authController._resolveUserInstitution(user, null);
    assert.equal(result.institution, validInstitution);
    assert.deepEqual(user.institutions, [validInstitution._id]);
    assert.equal(user.institution, validInstitution._id);
  } finally {
    Institution.find = originalFind;
  }
});

test('login does not treat the persisted current institution as an explicit institution selection', async () => {
  const User = require('../models/User');
  const Institution = require('../models/Institution');
  const authController = require('../controllers/authController');
  const originalFindOne = User.findOne;
  const originalFind = Institution.find;
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const staleInstitutionId = '64f8ff7f2e7f6d0012345678';
  const validInstitutionId = '64f8ff7f2e7f6d0098765432';
  const validInstitution = { _id: { toString: () => validInstitutionId }, name: 'Valid institution' };
  const user = {
    _id: { toString: () => '64f8ff7f2e7f6d0012349999' },
    name: 'Tenant Admin',
    email: 'tenant@example.com',
    role: 'admin',
    active: true,
    refreshTokenVersion: 0,
    institution: staleInstitutionId,
    institutions: [staleInstitutionId, validInstitutionId],
    populate: async function populate() { return this; },
    comparePassword: async () => true,
    save: async function save() {},
    toSafeJSON: () => ({ id: '64f8ff7f2e7f6d0012349999', role: 'admin' }),
  };
  User.findOne = () => ({ select: async () => user });
  Institution.find = () => ({ lean: async () => [validInstitution] });
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  const res = {
    cookie() {},
    json(body) { this.body = body; },
  };
  let handlerError;

  try {
    await authController.login(
      { body: { email: user.email, password: 'Password123' }, headers: {}, ip: '127.0.0.1' },
      res,
      (error) => { handlerError = error; }
    );
  } finally {
    User.findOne = originalFindOne;
    Institution.find = originalFind;
    if (originalAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalAccessSecret;
    if (originalRefreshSecret === undefined) delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
  }

  assert.equal(handlerError, undefined);
  assert.ok(res.body.accessToken);
  assert.equal(user.institution, validInstitution._id);
  assert.deepEqual(user.institutions, [validInstitution._id]);
});

test('login permits accounts with only stale institution references to recover without tenant access', async () => {
  const Institution = require('../models/Institution');
  const authController = require('../controllers/authController');
  const originalFind = Institution.find;
  Institution.find = () => ({ lean: async () => [] });

  const user = {
    role: 'admin',
    institution: '64f8ff7f2e7f6d0012345678',
    institutions: ['64f8ff7f2e7f6d0012345678'],
  };

  try {
    const result = await authController._resolveUserInstitution(user, null);
    assert.equal(result.institution, null);
    assert.deepEqual(result.institutions, []);
    assert.equal(user.institution, null);
    assert.deepEqual(user.institutions, []);
  } finally {
    Institution.find = originalFind;
  }
});

test('asset-user role cannot pass privileged route middleware', () => {
  const { requireRole } = require('../middleware/auth');
  let nextError;

  requireRole('admin', 'superadmin')(
    { user: { role: 'asset_user' } },
    {},
    (error) => { nextError = error; }
  );

  assert.equal(nextError.status, 403);
});

test('CSV export neutralizes formula-leading cells', () => {
  const reportController = require('../controllers/reportController');

  assert.equal(reportController._csvEscape('=SUM(1,1)'), '"\'=SUM(1,1)"');
  assert.equal(reportController._csvEscape('\t@SUM(1,1)'), '"\'\t@SUM(1,1)"');
  assert.equal(reportController._csvEscape('Laptop'), '"Laptop"');
});

test('report queries include the active tenant scope', async () => {
  const Asset = require('../models/Asset');
  const reportController = require('../controllers/reportController');
  const originalFind = Asset.find;
  let seenFilter;

  Asset.find = (filter) => {
    seenFilter = filter;
    return { select: () => ({ lean: async () => [] }) };
  };

  try {
    await reportController._getRows('assets', {
      user: { role: 'admin', institution: '64f8ff7f2e7f6d0012345678' },
    });
  } finally {
    Asset.find = originalFind;
  }

  assert.deepEqual(seenFilter, { institution: '64f8ff7f2e7f6d0012345678' });
});

test('document file resolver rejects paths outside the upload directory', async () => {
  const path = require('node:path');
  const documentController = require('../controllers/documentController');
  const outsidePath = path.join(__dirname, 'private.txt');

  await assert.rejects(
    documentController._resolveStoredFilePath(outsidePath),
    (error) => error.status === 404
  );
});

test('asset import ignores attacker-controlled storage and tenant fields', async () => {
  const Asset = require('../models/Asset');
  const importController = require('../controllers/importController');
  const originalSave = Asset.prototype.save;
  const originalFind = Asset.find;
  const originalAggregate = Asset.aggregate;
  const institutionId = '64f8ff7f2e7f6d0012345678';
  let responseBody;

  Asset.prototype.save = async function save() { return this; };
  Asset.find = () => ({
    select() { return this; },
    lean: async () => [],
  });
  Asset.aggregate = async () => [{ numericSuffix: 0 }];

  try {
    await importController.importAssets(
      {
        user: { _id: '64f8ff7f2e7f6d0012345679', role: 'admin', institution: institutionId },
        body: {
          institutionId: '64f8ff7f2e7f6d0098765432',
          assets: [{
            assetTag: 'AST-TEST-001',
            name: 'Imported test asset',
            category: 'Laptop',
            institution: '64f8ff7f2e7f6d0098765432',
            documents: [{ filePath: 'C:\\private\\secret.txt' }],
            createdBy: '64f8ff7f2e7f6d0098765432',
            qrCode: 'attacker-controlled',
          }],
        },
      },
      {
        status(code) { this.statusCode = code; return this; },
        json(body) { responseBody = body; },
      },
      (error) => { if (error) throw error; }
    );
  } finally {
    Asset.prototype.save = originalSave;
    Asset.find = originalFind;
    Asset.aggregate = originalAggregate;
  }

  const [asset] = responseBody.assets;
  assert.equal(asset.institution.toString(), institutionId);
  assert.equal(asset.createdBy.toString(), '64f8ff7f2e7f6d0012345679');
  assert.deepEqual(asset.documents, []);
  assert.notEqual(asset.qrCode, 'attacker-controlled');
});

test('derived-status pagination fetches only the requested page', async () => {
  const mongoose = require('mongoose');
  const { paginateDerivedStatus } = require('../utils/paginateDerivedStatus');
  const id = new mongoose.Types.ObjectId();
  const institutionId = '64f8ff7f2e7f6d0012345678';
  let pipeline;
  let findFilter;
  const document = {
    _id: id,
    toObject: () => ({ name: 'USB-C Dock', qtyAvailable: 2 }),
  };
  const query = {
    populate() { return this; },
    then(resolve, reject) { return Promise.resolve([document]).then(resolve, reject); },
  };

  const result = await paginateDerivedStatus({
    model: {
      aggregate: async (value) => {
        pipeline = value;
        return [{ data: [{ _id: id, _computedStatus: 'Low Stock' }], total: [{ value: 101 }] }];
      },
      find: (filter) => { findFilter = filter; return query; },
    },
    filter: { institution: institutionId },
    status: 'Low Stock',
    page: '2',
    limit: '50',
    computationStages: [],
    populate: [{ path: 'institution' }],
  });

  assert.ok(pipeline[0].$match.institution instanceof mongoose.Types.ObjectId);
  assert.equal(pipeline[0].$match.institution.toString(), institutionId);
  assert.ok(pipeline.some((stage) => stage.$facet?.data?.some((part) => part.$skip === 50)));
  assert.ok(pipeline.some((stage) => stage.$facet?.data?.some((part) => part.$limit === 50)));
  assert.deepEqual(findFilter, { _id: { $in: [id] } });
  assert.equal(result.pagination.total, 101);
  assert.equal(result.pagination.pages, 3);
  assert.equal(result.data[0].status, 'Low Stock');
});

test('accessory checkout schema rejects invalid quantities and defaults the quantity', () => {
  const { accessoryCheckoutSchema } = require('../utils/schemas');
  assert.equal(accessoryCheckoutSchema.safeParse({ name: 'User' }).data.quantity, 1);
  assert.equal(accessoryCheckoutSchema.safeParse({ name: 'User', quantity: '2' }).data.quantity, 2);
  assert.equal(accessoryCheckoutSchema.safeParse({ name: 'User', quantity: 0 }).success, false);
  assert.equal(accessoryCheckoutSchema.safeParse({ name: 'User', quantity: 1.5 }).success, false);
  assert.equal(accessoryCheckoutSchema.safeParse({ name: '   ' }).success, false);
});

test('accessory checkout atomically reserves stock within the active institution', async () => {
  const Accessory = require('../models/Accessory');
  const controller = require('../controllers/accessoryController');
  const originalFindOneAndUpdate = Accessory.findOneAndUpdate;
  const institutionId = '64f8ff7f2e7f6d0012345678';
  let filter;
  let update;
  let options;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };

  Accessory.findOneAndUpdate = async (seenFilter, seenUpdate, seenOptions) => {
    filter = seenFilter;
    update = seenUpdate;
    options = seenOptions;
    return { _id: 'accessory-1' };
  };

  try {
    await controller.checkoutAccessory(
      {
        params: { id: 'accessory-1' },
        body: { name: 'Assigned User', quantity: 2 },
        user: { _id: 'user-1', role: 'admin', institution: institutionId },
      },
      res,
      (error) => { throw error; }
    );
  } finally {
    Accessory.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(filter.institution, institutionId);
  assert.equal(filter.$expr.$gte[1], 2);
  assert.ok(filter.$expr.$gte[0].$subtract[1].$sum.$map);
  assert.equal(update.$push.checkouts.quantity, 2);
  assert.equal(options.new, true);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body._id, 'accessory-1');
});

test('accessory checkout reports stock conflicts when its atomic reservation fails', async () => {
  const Accessory = require('../models/Accessory');
  const controller = require('../controllers/accessoryController');
  const originalFindOneAndUpdate = Accessory.findOneAndUpdate;
  const originalExists = Accessory.exists;
  Accessory.findOneAndUpdate = async () => null;
  Accessory.exists = async () => true;
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };

  try {
    await controller.checkoutAccessory(
      {
        params: { id: 'accessory-1' },
        body: { name: 'Assigned User', quantity: 1 },
        user: { role: 'admin', institution: '64f8ff7f2e7f6d0012345678' },
      },
      response,
      (error) => { throw error; }
    );
  } finally {
    Accessory.findOneAndUpdate = originalFindOneAndUpdate;
    Accessory.exists = originalExists;
  }

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /Not enough stock/);
});

test('accessory check-in atomically marks only an active checkout as returned', async () => {
  const Accessory = require('../models/Accessory');
  const controller = require('../controllers/accessoryController');
  const originalFindOneAndUpdate = Accessory.findOneAndUpdate;
  let filter;
  let update;
  Accessory.findOneAndUpdate = async (seenFilter, seenUpdate) => {
    filter = seenFilter;
    update = seenUpdate;
    return { _id: 'accessory-1' };
  };

  try {
    await controller.checkinAccessory(
      {
        params: { id: 'accessory-1', checkoutId: 'checkout-1' },
        user: { _id: 'user-1', role: 'admin', institution: '64f8ff7f2e7f6d0012345678' },
      },
      { json(body) { this.body = body; } },
      (error) => { throw error; }
    );
  } finally {
    Accessory.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(filter.checkouts.$elemMatch._id, 'checkout-1');
  assert.equal(filter.checkouts.$elemMatch.$or.length, 2);
  assert.ok(update.$set['checkouts.$.checkinDate'] instanceof Date);
  assert.equal(update.$set['checkouts.$.checkedInBy'], 'user-1');
});

test('login route rate-limits repeated invalid requests', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    responses.push(await request(app).post('/api/auth/login').send({}));
  }

  assert.ok(responses.slice(0, 10).every((response) => response.status === 400));
  assert.equal(responses[10].status, 429);
  assert.ok(responses[10].headers['ratelimit-limit']);
});

test('legacy audit backfill only supports tenant-owned entity types', () => {
  const { getSourceInstitution, getSourceModel } = require('../scripts/backfillAuditInstitutions');
  assert.equal(getSourceInstitution({ institution: 'tenant-1' }), 'tenant-1');
  assert.equal(getSourceInstitution({ institution: { _id: 'tenant-2' } }), 'tenant-2');
  assert.equal(getSourceInstitution({ institution: null }), null);
  assert.ok(getSourceModel('Asset'));
  assert.ok(getSourceModel('Assignment'));
  assert.ok(getSourceModel('Maintenance'));
  assert.equal(getSourceModel('Auth'), null);
  assert.equal(getSourceModel('User'), null);
});
