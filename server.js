require('dotenv').config();
const crypto = require('crypto');
const app = require('./app');
const connectDB = require('./config/db');
const User = require('./models/User');

if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/asset-manager';
}

const ensureSecret = (key) => {
  if (process.env[key]) return process.env[key];
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${key}`);
  }
  const generated = crypto.randomBytes(32).toString('hex');
  process.env[key] = generated;
  return generated;
};

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'asset-manager-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'asset-manager-refresh-secret';
ensureSecret('JWT_ACCESS_SECRET');
ensureSecret('JWT_REFRESH_SECRET');

async function ensureDefaultUsers() {
  const email = (process.env.SEED_EMAIL || 'superadmin@gmail.com').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'super@123';

  const existingSuperAdmin = await User.findOne({ email });
  if (existingSuperAdmin) {
    existingSuperAdmin.name = process.env.SEED_NAME || 'Super Admin';
    existingSuperAdmin.password = password;
    existingSuperAdmin.role = 'superadmin';
    existingSuperAdmin.active = true;
    await existingSuperAdmin.save();
    console.log(`[startup] normalized default superadmin ${email}`);
  } else {
    await User.create({ name: process.env.SEED_NAME || 'Super Admin', email, password, role: 'superadmin' });
    console.log(`[startup] created default superadmin ${email}`);
  }

  const assetUserEmail = 'asset@gmail.com';
  const existingAssetUser = await User.findOne({ email: assetUserEmail });
  if (existingAssetUser) {
    existingAssetUser.name = 'Asset User';
    existingAssetUser.password = 'asset@123';
    existingAssetUser.role = 'asset_user';
    existingAssetUser.active = true;
    await existingAssetUser.save();
    console.log('[startup] normalized default asset user asset@gmail.com');
  } else {
    await User.create({ name: 'Asset User', email: assetUserEmail, password: 'asset@123', role: 'asset_user' });
    console.log('[startup] created default asset user asset@gmail.com');
  }
}

const requestedPort = Number(process.env.PORT || 5010);
const candidatePorts = process.env.PORT ? [requestedPort] : [requestedPort, 5011, 5012, 5013, 5014];

function listenOn(port, ports) {
  const server = app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (ports.length > 0) {
        const nextPort = ports.shift();
        console.warn(`[server] Port ${port} is already in use. Retrying on http://localhost:${nextPort}`);
        listenOn(nextPort, ports);
        return;
      }

      console.error(`[server] Unable to start on port ${port}. Please stop the process using it or set a different PORT value.`);
      process.exit(1);
    }

    console.error('[server] unexpected startup error:', err.message);
    process.exit(1);
  });
}

connectDB()
  .then(async () => {
    await ensureDefaultUsers();
    listenOn(candidatePorts[0], candidatePorts.slice(1));
  })
  .catch((err) => {
    console.error('[startup] failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
