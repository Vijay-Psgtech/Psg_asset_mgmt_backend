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
