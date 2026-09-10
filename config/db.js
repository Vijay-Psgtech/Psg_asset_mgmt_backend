const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in the environment');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log(`[db] connected -> ${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });
}

module.exports = connectDB;
