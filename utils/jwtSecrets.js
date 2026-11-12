const crypto = require('crypto');

function configureJwtSecrets(env = process.env) {
  const secretNames = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

  for (const name of secretNames) {
    if (!env[name]) {
      if (env.NODE_ENV === 'production') {
        throw new Error(`Missing required env var: ${name}`);
      }

      env[name] = crypto.randomBytes(32).toString('hex');
    }

    if (env[name].length < 32) {
      throw new Error(`${name} must be at least 32 characters long`);
    }
    if (/^replace_with_/i.test(env[name])) {
      throw new Error(`${name} must be replaced with a generated secret`);
    }
  }

  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
}

module.exports = { configureJwtSecrets };
