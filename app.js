const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

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
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

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
        connectSrc: ["'self'", 'http://localhost:5173', 'http://127.0.0.1:5173'],
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

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

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

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
