const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('People menu exposes a dedicated users directory route', () => {
  const layoutText = fs.readFileSync(path.join(__dirname, '../../client/src/layouts/AppLayout.jsx'), 'utf8');
  const appText = fs.readFileSync(path.join(__dirname, '../../client/src/App.jsx'), 'utf8');

  assert.match(layoutText, /to:\s*'\/users'/, 'Users menu item should route to /users');
  assert.match(appText, /<Route[^>]*path=["']users["'][^>]*>/, 'App routes should include a users page');
});

test('institution module and table columns are surfaced in the app UI', () => {
  const layoutText = fs.readFileSync(path.join(__dirname, '../../client/src/layouts/AppLayout.jsx'), 'utf8');
  const appText = fs.readFileSync(path.join(__dirname, '../../client/src/App.jsx'), 'utf8');
  const assetsText = fs.readFileSync(path.join(__dirname, '../../client/src/pages/Assets.jsx'), 'utf8');
  const usersText = fs.readFileSync(path.join(__dirname, '../../client/src/pages/Users.jsx'), 'utf8');

  assert.match(layoutText, /to:\s*'\/institutions'/, 'Institution menu item should route to /institutions');
  assert.match(appText, /<Route[^>]*path=["']institutions["'][^>]*>/, 'App routes should include an institutions page');
  assert.match(assetsText, /Institution/, 'Assets table should include Institution column');
  assert.match(usersText, /Institution/, 'Users table should include Institution column');
});

test('workspace pages do not load without an active institution assignment', () => {
  const layoutText = fs.readFileSync(path.join(__dirname, '../../client/src/layouts/AppLayout.jsx'), 'utf8');

  assert.match(layoutText, /user\.role !== 'superadmin' && !user\.institution/, 'Tenant-scoped workspace pages should be blocked for unassigned accounts');
  assert.match(layoutText, /Your account is not assigned to an institution/, 'The UI should explain how to resolve missing tenant access');
  assert.match(layoutText, /Ask a superadmin to assign your account/, 'The blocked state should identify the required admin action');
});

test('superadmins can select an institution when creating a user', () => {
  const usersText = fs.readFileSync(path.join(__dirname, '../../client/src/pages/Users.jsx'), 'utf8');
  const superDashboardText = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SuperDashboard.jsx'), 'utf8');

  assert.match(usersText, /Institution\s*<select/, 'The create-user form should provide an institution selector');
  assert.match(usersText, /institutionId: createForm\.institutionId/, 'The selected institution should be sent to the API');
  assert.match(usersText, /Select an institution for this account/, 'The form should require an institution');
  assert.match(superDashboardText, /api\.get\('\/institutions'\)/, 'The superadmin dashboard should load institutions');
  assert.match(superDashboardText, /!editing && <label className="label">Institution<select/, 'The dashboard create-user form should provide an institution selector');
  assert.match(superDashboardText, /institutionId:\s*''/, 'The create form should track its institution selection');
  assert.match(superDashboardText, /else await api\.post\('\/users', payload\)/, 'The selected institution should be sent when creating a user');
});
