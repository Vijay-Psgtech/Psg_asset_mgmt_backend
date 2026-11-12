const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const User = require('../models/User');
const notifications = require('../utils/notifications');

const originalSendEmail = notifications.sendEmail;
const originalSendPasswordResetEmail = notifications.sendPasswordResetEmail;
const originalIsPasswordResetDeliveryConfigured = notifications.isPasswordResetDeliveryConfigured;
let sendEmailFn = async () => true;
let sendPasswordResetEmailFn = async () => true;
let isPasswordResetDeliveryConfiguredFn = () => true;
notifications.sendEmail = (...args) => sendEmailFn(...args);
notifications.sendPasswordResetEmail = (...args) => sendPasswordResetEmailFn(...args);
notifications.isPasswordResetDeliveryConfigured = (...args) => isPasswordResetDeliveryConfiguredFn(...args);
const app = require('../app');
const authController = require('../controllers/authController');

test('password reset endpoints are mounted under the auth API route', async () => {
  const originalConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    from: process.env.MAIL_FROM,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    delivery: process.env.PASSWORD_RESET_DELIVERY,
  };
  for (const name of ['SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'PASSWORD_RESET_DELIVERY']) {
    delete process.env[name];
  }
  isPasswordResetDeliveryConfiguredFn = () => false;
  let forgotResponse;
  let resetResponse;
  let unconfiguredResponse;
  try {
    forgotResponse = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });
    resetResponse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'invalid', password: 'password123' });
    unconfiguredResponse = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'person@example.com' });
  } finally {
    isPasswordResetDeliveryConfiguredFn = () => true;
    for (const [name, value] of Object.entries({
      SMTP_HOST: originalConfig.host,
      SMTP_PORT: originalConfig.port,
      MAIL_FROM: originalConfig.from,
      SMTP_USER: originalConfig.user,
      SMTP_PASSWORD: originalConfig.password,
      PASSWORD_RESET_DELIVERY: originalConfig.delivery,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.equal(forgotResponse.status, 400);
  assert.equal(forgotResponse.body.error, 'ValidationError');
  assert.equal(resetResponse.status, 400);
  assert.equal(resetResponse.body.error, 'ValidationError');
  assert.equal(unconfiguredResponse.status, 503);
  assert.equal(unconfiguredResponse.body.error, 'ServiceUnavailableError');
  assert.match(unconfiguredResponse.body.message, /server\/\.env/);
});

function responseStub() {
  return {
    json(body) {
      this.body = body;
    },
  };
}

test('forgot password stores only a hashed, expiring token and emails the reset link', async () => {
  const originalFindOne = User.findOne;
  const user = {
    _id: 'user-id',
    email: 'person@example.com',
    async save() {
      this.saved = true;
    },
  };
  let email;
  User.findOne = async () => user;
  sendPasswordResetEmailFn = async (message) => {
    email = message;
    return true;
  };
  const res = responseStub();

  try {
    await authController.requestPasswordReset(
      { body: { email: ' Person@Example.com ' } },
      res,
      (error) => { throw error; }
    );
  } finally {
    User.findOne = originalFindOne;
    sendPasswordResetEmailFn = async () => true;
  }

  assert.equal(user.saved, true);
  assert.match(user.passwordResetTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(user.passwordResetExpires.getTime() > Date.now());
  assert.ok(user.passwordResetExpires.getTime() <= Date.now() + 60 * 60 * 1000);
  assert.match(email.text, /\/login\?resetToken=[a-f0-9]{64}/);
  const token = new URL(email.text.match(/https?:\/\/\S+/)[0]).searchParams.get('resetToken');
  assert.equal(
    user.passwordResetTokenHash,
    crypto.createHash('sha256').update(token).digest('hex')
  );
  assert.deepEqual(res.body, {
    message: 'If an active account exists for that email, a password reset link has been sent.',
  });
});

test('reset password atomically consumes the token and invalidates existing refresh tokens', async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const rawToken = crypto.randomBytes(32).toString('hex');
  let query;
  let update;
  User.findOneAndUpdate = async (filter, changes) => {
    query = filter;
    update = changes;
    return { _id: 'user-id' };
  };
  const res = responseStub();

  try {
    await authController.resetPassword(
      { body: { token: rawToken, password: 'a-new-password' } },
      res,
      (error) => { throw error; }
    );
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(query.passwordResetTokenHash, crypto.createHash('sha256').update(rawToken).digest('hex'));
  assert.ok(query.passwordResetExpires.$gt instanceof Date);
  assert.equal(update.$inc.refreshTokenVersion, 1);
  assert.equal(update.$set.passwordResetTokenHash, null);
  assert.equal(update.$set.passwordResetExpires, null);
  assert.equal(await bcrypt.compare('a-new-password', update.$set.password), true);
  assert.deepEqual(res.body, { message: 'Your password has been reset. You can now sign in with your new password.' });
});

test('console reset delivery is development-only and prints a usable link', async () => {
  const originalMode = process.env.PASSWORD_RESET_DELIVERY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalInfo = console.info;
  const mockedSender = notifications.sendPasswordResetEmail;
  const mockedDeliveryCheck = notifications.isPasswordResetDeliveryConfigured;
  let preview = '';
  process.env.PASSWORD_RESET_DELIVERY = 'console';
  process.env.NODE_ENV = 'development';
  console.info = (message) => { preview = message; };
  notifications.sendPasswordResetEmail = originalSendPasswordResetEmail;
  notifications.isPasswordResetDeliveryConfigured = originalIsPasswordResetDeliveryConfigured;

  try {
    assert.equal(notifications.isPasswordResetDeliveryConfigured(), true);
    await notifications.sendPasswordResetEmail({
      to: 'person@example.com',
      subject: 'Reset your password',
      text: 'http://localhost:5173/login?resetToken=one-time-token',
    });
    assert.match(preview, /resetToken=one-time-token/);
    process.env.NODE_ENV = 'production';
    assert.equal(notifications.isPasswordResetDeliveryConfigured(), false);
    assert.equal(await notifications.sendPasswordResetEmail({ text: 'must not be printed' }), false);
  } finally {
    console.info = originalInfo;
    notifications.sendPasswordResetEmail = mockedSender;
    notifications.isPasswordResetDeliveryConfigured = mockedDeliveryCheck;
    if (originalMode === undefined) delete process.env.PASSWORD_RESET_DELIVERY;
    else process.env.PASSWORD_RESET_DELIVERY = originalMode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('password reset schemas reject malformed tokens and weak passwords', () => {
  const { forgotPasswordSchema, resetPasswordSchema } = require('../utils/schemas');

  assert.equal(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: 'short', password: 'password123' }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'short' }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'password123' }).success, true);
});

test.after(() => {
  notifications.sendEmail = originalSendEmail;
  notifications.sendPasswordResetEmail = originalSendPasswordResetEmail;
  notifications.isPasswordResetDeliveryConfigured = originalIsPasswordResetDeliveryConfigured;
});
