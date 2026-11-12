const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const request = require('supertest');
const mongoose = require('mongoose');

process.env.JWT_ACCESS_SECRET ||= crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(32).toString('hex');
if (process.env.TEST_MONGO_URI) process.env.MONGO_URI = process.env.TEST_MONGO_URI;

const app = require('../app');
const User = require('../models/User');
const Institution = require('../models/Institution');
const Asset = require('../models/Asset');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const Assignment = require('../models/Assignment');
const Maintenance = require('../models/Maintenance');
const { UPLOAD_ROOT } = require('../middleware/upload');

const mongoUri = process.env.TEST_MONGO_URI;
const password = 'TestPassword!234';

test('Mongo-backed API contracts, auth, tenant access, CRUD, files, dashboard, and notifications', {
  skip: !mongoUri && 'Set TEST_MONGO_URI to run isolated MongoDB integration tests',
}, async (t) => {
  const parsedUri = new URL(mongoUri);
  assert.match(parsedUri.pathname, /test/i, 'TEST_MONGO_URI must point to a dedicated test database');

  await mongoose.connect(mongoUri);
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Institution.init(),
    User.init(),
    Asset.init(),
    AuditLog.init(),
    Notification.init(),
    Assignment.init(),
    Maintenance.init(),
  ]);
  let assetId;
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (assetId) {
      await fs.rm(path.join(UPLOAD_ROOT, assetId), { recursive: true, force: true });
    }
  });

  const [institutionA, institutionB] = await Institution.create([
    { name: 'Test Institution A', code: 'TESTA' },
    { name: 'Test Institution B', code: 'TESTB' },
  ]);
  const [adminA, memberA, adminB, superadmin] = await Promise.all([
    User.create({ name: 'Admin A', email: 'admin-a@test.invalid', password, role: 'admin', institution: institutionA._id, institutions: [institutionA._id] }),
    User.create({ name: 'Member A', email: 'member-a@test.invalid', password, role: 'asset_user', institution: institutionA._id, institutions: [institutionA._id] }),
    User.create({ name: 'Admin B', email: 'admin-b@test.invalid', password, role: 'admin', institution: institutionB._id, institutions: [institutionB._id] }),
    User.create({ name: 'Super Admin', email: 'superadmin@test.invalid', password, role: 'superadmin' }),
  ]);

  async function login(email) {
    const response = await request(app).post('/api/auth/login').send({ email, password });
    assert.equal(response.status, 200, response.text);
    assert.ok(response.body.accessToken);
    assert.equal(response.body.user.password, undefined);
    return {
      token: response.body.accessToken,
      cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
      user: response.body.user,
    };
  }

  const sessionA = await login(adminA.email);
  const sessionMember = await login(memberA.email);
  const sessionB = await login(adminB.email);
  const sessionSuper = await login(superadmin.email);

  await t.test('authentication, validation, RBAC, and registration', async () => {
    assert.equal((await request(app).get('/api/assets')).status, 401);
    const invalidId = await request(app).get('/api/assets/not-an-id')
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(invalidId.status, 400);
    assert.equal(typeof invalidId.body.error, 'string');
    assert.equal(typeof invalidId.body.message, 'string');
    assert.ok(Array.isArray(invalidId.body.details));

    assert.equal(
      (await request(app).post('/api/auth/login').send({ email: adminA.email, password: 'wrong-password' })).status,
      401
    );
    assert.equal(
      (await request(app).post('/api/assets').set('Authorization', `Bearer ${sessionMember.token}`).send({ name: 'No permission', category: 'Laptop' })).status,
      403
    );
    assert.equal(
      (await request(app).get('/api/eulas').set('Authorization', `Bearer ${sessionMember.token}`)).status,
      200,
      'asset users need read access to their own EULA list'
    );
    assert.equal(
      (await request(app).post('/api/eulas').set('Authorization', `Bearer ${sessionMember.token}`).send({ title: 'Forbidden' })).status,
      403
    );
    assert.equal((await request(app).get('/api/assignments').set('Authorization', `Bearer ${sessionMember.token}`)).status, 403);
    assert.equal((await request(app).get('/api/maintenance').set('Authorization', `Bearer ${sessionMember.token}`)).status, 403);

    const registration = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${sessionSuper.token}`)
      .send({ name: 'Registered User', email: 'registered@test.invalid', password, role: 'admin', institutionId: institutionB._id.toString() });
    assert.equal(registration.status, 201, registration.text);
    assert.equal(registration.body.user.password, undefined);
    assert.equal(registration.body.user.institution.id, institutionB._id.toString());
    assert.equal(
      (await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${sessionSuper.token}`)
        .send({ name: 'Registered User', email: 'registered@test.invalid', password })).status,
      409
    );

    const switched = await request(app)
      .post('/api/auth/switch-institution')
      .set('Authorization', `Bearer ${sessionSuper.token}`)
      .send({ institutionId: institutionB._id.toString() });
    assert.equal(switched.status, 200, switched.text);
    assert.equal(switched.body.user.institution.id, institutionB._id.toString());

    const forbiddenRegistration = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ name: 'Blocked User', email: 'blocked@test.invalid', password });
    assert.equal(forbiddenRegistration.status, 403);
  });

  await t.test('asset CRUD, tenant isolation, and audit persistence', async () => {
    const created = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ name: 'Integration Laptop', category: 'Laptop', purchaseCost: 1200 });
    assert.equal(created.status, 201, created.text);
    assetId = created.body.asset._id;
    assert.match(created.body.asset.assetTag, /^AST-\d+$/);
    assert.equal(await Asset.countDocuments({ _id: assetId, institution: institutionA._id }), 1);
    assert.equal(await AuditLog.countDocuments({ entityId: assetId, action: 'create' }), 1);

    const listA = await request(app).get('/api/assets?page=1&limit=5')
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(listA.status, 200, listA.text);
    assert.ok(listA.body.items.some((asset) => asset._id === assetId));
    assert.equal(listA.body.pagination.page, 1);

    const listB = await request(app).get('/api/assets')
      .set('Authorization', `Bearer ${sessionB.token}`);
    assert.equal(listB.status, 200, listB.text);
    assert.equal(listB.body.items.some((asset) => asset._id === assetId), false);

    const crossTenantRead = await request(app).get(`/api/assets/${assetId}`)
      .set('Authorization', `Bearer ${sessionB.token}`);
    assert.equal(crossTenantRead.status, 403);

    const updated = await request(app).put(`/api/assets/${assetId}`)
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ name: 'Updated Integration Laptop' });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.body.asset.name, 'Updated Integration Laptop');
    assert.equal(await AuditLog.countDocuments({ entityId: assetId, action: 'update' }), 1);

    const activity = await request(app).get('/api/dashboard/activity?limit=1')
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(activity.status, 200, activity.text);
    assert.ok(activity.body.data.length <= 1);
  });

  await t.test('assignment checkout/check-in and maintenance lifecycle', async () => {
    const checkout = await request(app)
      .post('/api/assignments/checkout')
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ assetId, assignedTo: { name: 'Integration Assignee', email: 'assignee@test.invalid' } });
    assert.equal(checkout.status, 201, checkout.text);
    const assignmentId = checkout.body._id;
    assert.equal((await Asset.findById(assetId)).status, 'assigned');
    assert.equal(await Assignment.countDocuments({ _id: assignmentId, status: 'assigned' }), 1);

    const duplicateCheckout = await request(app)
      .post('/api/assignments/checkout')
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ assetId, assignedTo: { name: 'Second Assignee' } });
    assert.equal(duplicateCheckout.status, 409);

    const checkin = await request(app)
      .patch(`/api/assignments/${assignmentId}/checkin`)
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ conditionIn: 'Good' });
    assert.equal(checkin.status, 200, checkin.text);
    assert.equal(checkin.body.status, 'returned');
    assert.equal((await Asset.findById(assetId)).status, 'available');

    const maintenance = await request(app)
      .post('/api/maintenance')
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ assetId, title: 'Integration repair', type: 'Repair', cost: 50 });
    assert.equal(maintenance.status, 201, maintenance.text);
    const maintenanceId = maintenance.body._id;
    assert.equal((await Asset.findById(assetId)).status, 'in_maintenance');

    const completed = await request(app)
      .patch(`/api/maintenance/${maintenanceId}`)
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({ status: 'Completed' });
    assert.equal(completed.status, 200, completed.text);
    assert.ok(completed.body.completedDate);
    assert.equal((await Asset.findById(assetId)).status, 'available');

    const listed = await request(app).get('/api/maintenance?status=Completed&limit=1')
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(listed.status, 200, listed.text);
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.pagination.limit, 1);
  });

  await t.test('document upload/download authorization and database metadata', async () => {
    const missingFile = await request(app)
      .post(`/api/assets/${assetId}/documents`)
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(missingFile.status, 400);

    const uploaded = await request(app)
      .post(`/api/assets/${assetId}/documents`)
      .set('Authorization', `Bearer ${sessionA.token}`)
      .attach('file', Buffer.from('%PDF-1.4 integration fixture'), { filename: 'fixture.pdf', contentType: 'application/pdf' });
    assert.equal(uploaded.status, 201, uploaded.text);
    const documentId = uploaded.body.document._id;
    assert.equal(uploaded.body.document.filePath, undefined);

    const listed = await request(app).get(`/api/assets/${assetId}/documents`)
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(listed.status, 200, listed.text);
    assert.equal(listed.body.documents.length, 1);
    assert.equal(listed.body.documents[0].filePath, undefined);
    assert.equal(listed.body.documents[0].fileName, undefined);

    const downloaded = await request(app).get(`/api/assets/${assetId}/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers['content-disposition'], /fixture\.pdf/);

    const crossTenantDownload = await request(app).get(`/api/assets/${assetId}/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${sessionB.token}`);
    assert.equal(crossTenantDownload.status, 404);

    const forbiddenUpload = await request(app)
      .post(`/api/assets/${assetId}/documents`)
      .set('Authorization', `Bearer ${sessionMember.token}`)
      .attach('file', Buffer.from('not allowed'), { filename: 'blocked.pdf', contentType: 'application/pdf' });
    assert.equal(forbiddenUpload.status, 403);

    const removed = await request(app).delete(`/api/assets/${assetId}/documents/${documentId}`)
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(removed.status, 204);
    assert.equal((await Asset.findById(assetId)).documents.length, 0);

    const rejectedType = await request(app)
      .post(`/api/assets/${assetId}/documents`)
      .set('Authorization', `Bearer ${sessionA.token}`)
      .attach('file', Buffer.from('script'), { filename: 'unsafe.html', contentType: 'text/html' });
    assert.equal(rejectedType.status, 400);

    const oversized = await request(app)
      .post(`/api/assets/${assetId}/documents`)
      .set('Authorization', `Bearer ${sessionA.token}`)
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'oversized.pdf', contentType: 'application/pdf' });
    assert.equal(oversized.status, 400, oversized.text);
    assert.equal(oversized.body.error, 'ValidationError');
    assert.match(oversized.body.message, /10 MB/);
    assert.equal((await Asset.findById(assetId)).documents.length, 0);
  });

  await t.test('dashboard, notifications, refresh rotation, and logout', async () => {
    const summary = await request(app).get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(summary.status, 200, summary.text);
    assert.equal(summary.body.totalAssets, 1);
    assert.equal(summary.body.byStatus.available, 1, summary.text);
    assert.equal(summary.body.totals.people, 2);

    const notification = await Notification.create({
      recipient: memberA._id,
      title: 'Integration notification',
      message: 'Test message',
    });
    const memberNotifications = await request(app).get('/api/notifications')
      .set('Authorization', `Bearer ${sessionMember.token}`);
    assert.equal(memberNotifications.status, 200, memberNotifications.text);
    assert.ok(memberNotifications.body.notifications.some((item) => item._id === notification._id.toString()));

    const otherMemberRead = await request(app).patch(`/api/notifications/${notification._id}/read`)
      .set('Authorization', `Bearer ${sessionA.token}`);
    assert.equal(otherMemberRead.status, 404);

    const markedRead = await request(app).patch(`/api/notifications/${notification._id}/read`)
      .set('Authorization', `Bearer ${sessionMember.token}`);
    assert.equal(markedRead.status, 200, markedRead.text);
    assert.ok(markedRead.body.notification.readAt);

    await Notification.create([
      { recipient: memberA._id, title: 'Unread one', message: 'One' },
      { recipient: memberA._id, title: 'Unread two', message: 'Two' },
    ]);
    const markedAll = await request(app).patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${sessionMember.token}`);
    assert.equal(markedAll.status, 200, markedAll.text);
    assert.equal(await Notification.countDocuments({ recipient: memberA._id, readAt: null }), 0);

    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/auth/login').send({ email: adminA.email, password });
    assert.equal(loggedIn.status, 200);
    const oldRefreshCookie = loggedIn.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(oldRefreshCookie);
    const refreshed = await agent.post('/api/auth/refresh');
    assert.equal(refreshed.status, 200, refreshed.text);
    assert.ok(refreshed.body.accessToken);

    const loggedOut = await agent.post('/api/auth/logout');
    assert.equal(loggedOut.status, 204);
    assert.equal((await agent.post('/api/auth/refresh')).status, 401);
    assert.equal(
      (await request(app).post('/api/auth/refresh').set('Cookie', oldRefreshCookie)).status,
      401,
      'logout must revoke the refresh token, not just clear the browser cookie'
    );
  });

  await t.test('asset model constraints and unique tenant tag index', async () => {
    const invalid = new Asset({ institution: institutionA._id, assetTag: 'AST-BAD', name: '', category: 'invalid', purchaseCost: -1 });
    await assert.rejects(invalid.validate(), (error) => error.name === 'ValidationError');

    const duplicate = new Asset({
      institution: institutionA._id,
      assetTag: (await Asset.findById(assetId)).assetTag,
      name: 'Duplicate tag',
      category: 'Laptop',
    });
    await assert.rejects(duplicate.save(), (error) => error.code === 11000);

    const sameTagOtherTenant = new Asset({
      institution: institutionB._id,
      assetTag: (await Asset.findById(assetId)).assetTag,
      name: 'Same tag in another tenant',
      category: 'Laptop',
    });
    await sameTagOtherTenant.save();
    assert.equal(await Asset.countDocuments({ assetTag: sameTagOtherTenant.assetTag }), 2);

    await User.updateOne({ _id: adminB._id }, { $set: { active: false } });
    assert.equal(
      (await request(app).get('/api/assets').set('Authorization', `Bearer ${sessionB.token}`)).status,
      401
    );
    assert.equal(
      (await request(app).post('/api/auth/refresh').set('Cookie', sessionB.cookie)).status,
      401
    );
  });

  const deleted = await request(app).delete(`/api/assets/${assetId}`)
    .set('Authorization', `Bearer ${sessionA.token}`);
  assert.equal(deleted.status, 204);
  assert.equal(await Asset.exists({ _id: assetId }), null);
});
