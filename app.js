const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const assetRoutes = require('./routes/assetRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const auditRoutes = require('./routes/auditRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const accessoryRoutes = require('./routes/accessoryRoutes');
const consumableRoutes = require('./routes/consumableRoutes');
const licenseRoutes = require('./routes/licenseRoutes');
const documentListRoutes = require('./routes/documentListRoutes');
const reportRoutes = require('./routes/reportRoutes');
const requirementRoutes = require('./routes/requirementRoutes');
const assetRequestRoutes = require('./routes/assetRequestRoutes');
const userRoutes = require('./routes/userRoutes');
const componentRoutes = require('./routes/componentRoutes');
const kitRoutes = require('./routes/kitRoutes');
const eulaRoutes = require('./routes/eulaRoutes');
const importRoutes = require('./routes/importRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const institutionRoutes = require('./routes/institutionRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'http://localhost:5173', 'http://127.0.0.1:5173', 'https://assettest.psginstitutions.in'],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    hsts: process.env.NODE_ENV === 'production',
  })
);

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://assettest.psginstitutions.in',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
  ],
  exposedHeaders: ['X-Request-Id'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    if ((res.statusCode >= 500 && req.path !== '/api/ready') || durationMs >= 1000) {
      logger.warn('http_request_slow_or_failed', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      });
    }
  });
  next();
});

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready',
  message: { error: 'TooManyRequests', message: 'Too many requests, please try again later' },
}));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: { database: ready ? 'connected' : 'disconnected' },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/accessories', accessoryRoutes);
app.use('/api/consumables', consumableRoutes);
app.use('/api/licenses', licenseRoutes);
app.use('/api/documents', documentListRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/requirements', requirementRoutes);
app.use('/api/asset-requests', assetRequestRoutes);
app.use('/api/users', userRoutes);
app.use('/api/components', componentRoutes);
app.use('/api/kits', kitRoutes);
app.use('/api/eulas', eulaRoutes);
app.use('/api/import', importRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/institutions', institutionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
