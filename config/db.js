const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in the environment');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  logger.info('database_connected', { database: mongoose.connection.name });

  mongoose.connection.on('error', (err) => {
    logger.error('database_connection_error', {
      errorName: err.name || 'Error',
      errorCode: err.code,
    });
  });
}

module.exports = connectDB;
