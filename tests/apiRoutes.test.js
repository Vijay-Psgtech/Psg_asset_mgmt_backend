const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../app');

function discoverApiRoutes() {
  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const routeModules = new Map(
    [...appSource.matchAll(/const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)]
      .map((match) => [match[1], match[2]])
  );
  const mounts = new Map(
    [...appSource.matchAll(/app\.use\(['"]\/api([^'"]*)['"],\s*(\w+)\)/g)]
      .map((match) => [routeModules.get(match[2]), `/api${match[1]}`])
  );
  const routesDirectory = path.join(__dirname, '../routes');
  const routes = [];

  for (const filename of fs.readdirSync(routesDirectory).filter((entry) => entry.endsWith('Routes.js'))) {
    const source = fs.readFileSync(path.join(routesDirectory, filename), 'utf8');
    let prefix = mounts.get(filename.replace(/\.js$/, ''));
    if (!prefix && filename === 'documentRoutes.js') prefix = '/api/assets/:id/documents';
    if (!prefix) continue;

    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      const suffix = match[2] === '/' ? '' : match[2];
      const routePath = `${prefix}${suffix}`
        .replace(/\/:([\w]+)/g, (_whole, name) => (
          name.toLowerCase().includes('tag') ? '/route-probe' : '/000000000000000000000001'
        ));
      routes.push({ method: match[1], path: routePath });
    }
  }

  return [
    ...routes,
    { method: 'get', path: '/api/health' },
    { method: 'get', path: '/api/ready' },
  ];
}

function expectedUnauthenticatedStatus(route) {
  if (route.path === '/api/health') return [200];
  if (route.path === '/api/ready') return [200, 503];
  if (['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password'].includes(route.path)) return [400];
  if (route.path === '/api/auth/logout') return [204];
  if (route.path === '/api/auth/refresh') return [401];
  return [401];
}

test('CORS preflight allows the headers used by the frontend', async () => {
  const origin = process.env.CLIENT_URL || 'http://localhost:5173';
  const response = await request(app)
    .options('/api/auth/login')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,x-requested-with');

  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.match(response.headers['access-control-allow-headers'], /x-requested-with/i);
});

test('all registered API routes are mounted and enforce unauthenticated access behavior', async () => {
  const routes = discoverApiRoutes();
  assert.ok(routes.length >= 80, `Expected a complete API route inventory, found ${routes.length}`);

  for (const route of routes) {
    let apiRequest = request(app)[route.method](route.path);
    if (route.path === '/api/auth/register') {
      apiRequest = apiRequest.send({
        name: 'Probe User',
        email: 'probe@example.invalid',
        password: 'ProbePass123',
      });
    } else if (['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password'].includes(route.path)) {
      apiRequest = apiRequest.send({});
    }

    const response = await apiRequest;
    assert.ok(
      expectedUnauthenticatedStatus(route).includes(response.status),
      `${route.method.toUpperCase()} ${route.path} returned ${response.status}`
    );
  }
});
