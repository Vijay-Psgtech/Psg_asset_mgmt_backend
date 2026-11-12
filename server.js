require('dotenv').config();
const { configureJwtSecrets } = require('./utils/jwtSecrets');
const logger = require('./utils/logger');

configureJwtSecrets();

const app = require('./app');
const connectDB = require('./config/db');

if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/asset-manager';
}

const requestedPort = Number(process.env.PORT || 5010);
const candidatePorts = process.env.PORT ? [requestedPort] : [requestedPort, 5011, 5012, 5013, 5014];

function listenOn(port, ports) {
  const server = app.listen(port, () => {
    logger.info('server_listening', { port });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (ports.length > 0) {
        const nextPort = ports.shift();
        logger.warn('server_port_in_use', { port, retryPort: nextPort });
        listenOn(nextPort, ports);
        return;
      }

      logger.error('server_start_failed_port_in_use', { port });
      process.exit(1);
    }

    logger.error('server_start_failed', { errorName: err.name || 'Error', errorCode: err.code });
    process.exit(1);
  });
}

connectDB()
  .then(() => listenOn(candidatePorts[0], candidatePorts.slice(1)))
  .catch((err) => {
    logger.error('database_startup_failed', { errorName: err.name || 'Error', errorCode: err.code });
    process.exit(1);
  });
