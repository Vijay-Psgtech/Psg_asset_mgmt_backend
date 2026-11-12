const nodemailer = require('nodemailer');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Assignment = require('../models/Assignment');

let transporter;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.MAIL_FROM) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

function emailConfigurationIssues() {
  const issues = [];
  const port = Number(process.env.SMTP_PORT);
  if (!process.env.SMTP_HOST) issues.push('SMTP_HOST');
  if (!process.env.SMTP_PORT || !Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push('SMTP_PORT (must be a valid port number)');
  }
  if (!process.env.MAIL_FROM) issues.push('MAIL_FROM');
  if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) {
    issues.push('SMTP_USER and SMTP_PASSWORD (both must be set together)');
  }
  return issues;
}

function isEmailConfigured() {
  return emailConfigurationIssues().length === 0;
}

function passwordResetDeliveryIssues() {
  const mode = process.env.PASSWORD_RESET_DELIVERY || 'smtp';
  if (mode === 'console') {
    return process.env.NODE_ENV === 'production'
      ? ['PASSWORD_RESET_DELIVERY=console is disabled in production']
      : [];
  }
  if (mode !== 'smtp') return ['PASSWORD_RESET_DELIVERY must be smtp or console'];
  return emailConfigurationIssues();
}

function isPasswordResetDeliveryConfigured() {
  return passwordResetDeliveryIssues().length === 0;
}

async function sendEmail({ to, subject, text }) {
  const mailer = getTransporter();
  if (!mailer || !to) return false;
  try {
    await mailer.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error('[notifications] email delivery failed:', err.message);
    return false;
  }
}

async function sendPasswordResetEmail(message) {
  if ((process.env.PASSWORD_RESET_DELIVERY || 'smtp') === 'console') {
    if (process.env.NODE_ENV === 'production') return false;
    console.info(`[password-reset-preview] Development reset link (expires in one hour):\n${message.text}`);
    return true;
  }
  return sendEmail(message);
}

async function notifyUser({ user, type, title, message, entityType, entityId }) {
  if (!user?._id) return null;
  const notification = await Notification.create({ recipient: user._id, type, title, message, entityType, entityId });
  await sendEmail({ to: user.email, subject: title, text: message });
  return notification;
}

async function findUserByPerson(person) {
  if (!person?.email) return null;
  return User.findOne({ email: person.email.toLowerCase(), active: true });
}

async function notifyCurrentAssignee({ assetId, type, title, message, entityType, entityId }) {
  if (!assetId) return null;
  const assignment = await Assignment.findOne({ asset: assetId, status: { $ne: 'returned' } }).sort({ checkoutDate: -1 }).lean();
  const user = await findUserByPerson(assignment?.assignedTo);
  return notifyUser({ user, type, title, message, entityType, entityId });
}

async function notifySafely(callback) {
  try {
    await callback();
  } catch (err) {
    console.error('[notifications] in-app notification failed:', err.message);
  }
}

module.exports = {
  notifyUser,
  findUserByPerson,
  notifyCurrentAssignee,
  notifySafely,
  sendEmail,
  isEmailConfigured,
  emailConfigurationIssues,
  isPasswordResetDeliveryConfigured,
  passwordResetDeliveryIssues,
  sendPasswordResetEmail,
};