// Creates a local admin and a complete, linked demo dataset.
// Usage: npm run seed  (reads SEED_EMAIL / SEED_PASSWORD / SEED_NAME from env)
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Requirement = require('../models/Requirement');
const Asset = require('../models/Asset');
const Assignment = require('../models/Assignment');
const Maintenance = require('../models/Maintenance');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const Accessory = require('../models/Accessory');
const Consumable = require('../models/Consumable');    
const License = require('../models/License');
const AuditLog = require('../models/AuditLog');
const AssetRequest = require('../models/AssetRequest');
const { requirementCatalog } = require('./requirementCatalog');

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

async function seedRequirements() {
  await Requirement.bulkWrite(requirementCatalog.map((item) => ({
    updateOne: { filter: { code: item.code }, update: { $set: item }, upsert: true },
  })));
  console.log(`[seed] synchronized ${requirementCatalog.length} requirements`);
}

async function seedAssets(admin) {
  const definitions = [
    { assetTag: 'AST-DEMO-001', name: 'ThinkPad X1 Carbon', category: 'Laptop', brand: 'Lenovo', model: 'X1 Carbon Gen 11', serialNumber: 'DEMO-LEN-001', status: 'available', purchaseDate: daysFromNow(-240), purchaseCost: 1450, vendor: 'Lenovo Business', location: 'HQ / Floor 3 / Room 301', warrantyExpiry: daysFromNow(480), notes: 'Demo laptop ready for assignment' },
    { assetTag: 'AST-DEMO-002', name: 'MacBook Pro 14', category: 'Laptop', brand: 'Apple', model: 'MacBook Pro M3', serialNumber: 'DEMO-APL-002', status: 'assigned', purchaseDate: daysFromNow(-120), purchaseCost: 2199, vendor: 'Apple Business', location: 'HQ / Floor 2 / Room 204', warrantyExpiry: daysFromNow(610) },
    { assetTag: 'AST-DEMO-003', name: 'Dell UltraSharp Monitor', category: 'Monitor', brand: 'Dell', model: 'U2723QE', serialNumber: 'DEMO-DEL-003', status: 'in_maintenance', purchaseDate: daysFromNow(-500), purchaseCost: 620, vendor: 'Dell Business', location: 'HQ / Floor 2 / Room 204', warrantyExpiry: daysFromNow(30) },
    { assetTag: 'AST-DEMO-004', name: 'Cisco Network Switch', category: 'Networking', brand: 'Cisco', model: 'CBS350-24T', serialNumber: 'DEMO-CIS-004', status: 'available', purchaseDate: daysFromNow(-90), purchaseCost: 890, vendor: 'Network Supply Co', location: 'HQ / Server Room', warrantyExpiry: daysFromNow(730) },
    { assetTag: 'AST-DEMO-005', name: 'iPhone 15 Pro', category: 'Phone', brand: 'Apple', model: 'iPhone 15 Pro', serialNumber: 'DEMO-APL-005', status: 'retired', purchaseDate: daysFromNow(-900), purchaseCost: 999, vendor: 'Apple Business', location: 'Archive', warrantyExpiry: daysFromNow(-540) },
  ];
  const assets = [];
  for (const definition of definitions) {
    const asset = await Asset.findOneAndUpdate(
      { assetTag: definition.assetTag },
      { $setOnInsert: { ...definition, createdBy: admin._id, qrCode: `demo-qr:${definition.assetTag}` } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    assets.push(asset);
  }
  console.log(`[seed] synchronized ${assets.length} assets`);
  return assets;
}

async function seedAssignments(admin, assetUser, assets) {
  const assignedAsset = assets.find((asset) => asset.assetTag === 'AST-DEMO-002');
  let assignment = await Assignment.findOne({ asset: assignedAsset._id, 'assignedTo.email': assetUser.email });
  if (!assignment) {
    assignment = await Assignment.create({ asset: assignedAsset._id, assignedTo: { name: assetUser.name, email: assetUser.email, department: 'Operations' }, checkedOutBy: admin._id, checkoutDate: daysFromNow(-18), dueDate: daysFromNow(45), conditionOut: 'Excellent', notes: 'Seeded demo assignment', status: 'assigned' });
  }
  assignedAsset.status = 'assigned';
  assignedAsset.currentAssignment = assignment._id;
  await assignedAsset.save();
  console.log('[seed] synchronized asset assignment');
}

async function seedMaintenance(admin, assets) {
  const maintenanceAsset = assets.find((asset) => asset.assetTag === 'AST-DEMO-003');
  await Maintenance.findOneAndUpdate(
    { title: 'Demo monitor panel inspection', asset: maintenanceAsset._id },
    { $setOnInsert: { asset: maintenanceAsset._id, type: 'Inspection', title: 'Demo monitor panel inspection', description: 'Inspect display flicker and replace panel cable if required.', vendor: 'Internal IT', cost: 85, startDate: daysFromNow(-2), dueDate: daysFromNow(3), status: 'In Progress', createdBy: admin._id, notes: 'Seeded demo maintenance record' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await Maintenance.findOneAndUpdate(
    { title: 'Demo laptop preventive service', asset: assets[0]._id },
    { $setOnInsert: { asset: assets[0]._id, type: 'Scheduled Service', title: 'Demo laptop preventive service', description: 'Quarterly health check and cleaning.', vendor: 'Internal IT', cost: 40, startDate: daysFromNow(20), dueDate: daysFromNow(30), status: 'Scheduled', createdBy: admin._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await MaintenanceRecord.findOneAndUpdate(
    { description: 'Demo completed maintenance history', asset: assets[0]._id },
    { $setOnInsert: { asset: assets[0]._id, type: 'routine', description: 'Demo completed maintenance history', cost: 35, scheduledDate: daysFromNow(-45), completedDate: daysFromNow(-40), status: 'completed', performedBy: 'Internal IT', createdBy: admin._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log('[seed] synchronized maintenance records');
}

async function seedInventory(admin, assetUser, assignedAsset) {
  const accessory = await Accessory.findOneAndUpdate(
    { name: 'USB-C Docking Station' },
    { $setOnInsert: { name: 'USB-C Docking Station', category: 'Docking', manufacturer: 'Anker', modelNumber: 'A8381', totalQty: 12, minQty: 3, purchaseDate: daysFromNow(-70), cost: 129, notes: 'Demo accessory stock' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (!accessory.checkouts.some((checkout) => checkout.assignedTo.email === assetUser.email && !checkout.checkinDate)) {
    accessory.checkouts.push({ assignedTo: { name: assetUser.name, email: assetUser.email, department: 'Operations' }, quantity: 1, checkedOutBy: admin._id, notes: 'Seeded demo checkout' });
    await accessory.save();
  }

  const consumable = await Consumable.findOneAndUpdate(
    { name: 'HP 26A Toner Cartridge' },
    { $setOnInsert: { name: 'HP 26A Toner Cartridge', category: 'Toner', manufacturer: 'HP', modelNumber: 'CF226A', totalQty: 25, minQty: 5, purchaseDate: daysFromNow(-35), cost: 88, notes: 'Demo consumable stock' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (!consumable.issues.some((issue) => issue.assignedTo.email === assetUser.email)) {
    consumable.issues.push({ assignedTo: { name: assetUser.name, email: assetUser.email, department: 'Operations' }, quantity: 2, issuedBy: admin._id, notes: 'Seeded demo issue' });
    await consumable.save();
  }

  const license = await License.findOneAndUpdate(
    { name: 'Adobe Creative Cloud' },
    { $setOnInsert: { name: 'Adobe Creative Cloud', licenseKey: 'DEMO-ADOBE-KEY', vendor: 'Adobe', category: 'Design', seats: 10, purchaseDate: daysFromNow(-90), expirationDate: daysFromNow(275), cost: 649, notes: 'Demo software license' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (!license.seatAssignments.some((seat) => seat.assignedTo.email === assetUser.email)) {
    license.seatAssignments.push({ assignedTo: { name: assetUser.name, email: assetUser.email }, asset: assignedAsset._id, assignedBy: admin._id, notes: 'Seeded demo license seat' });
    await license.save();
  }
  console.log('[seed] synchronized accessories, consumables, and licenses');
}

async function seedAudit(admin, assets) {
  const label = 'DEMO_SEED_INITIALIZED';
  if (!await AuditLog.exists({ entityLabel: label })) {
    await AuditLog.create({ action: 'create', entityType: 'Asset', entityId: assets[0]._id, entityLabel: label, performedBy: { id: admin._id, name: admin.name, email: admin.email }, changes: { source: 'seed', modules: ['assets', 'assignments', 'maintenance', 'inventory', 'licenses'] }, ipAddress: '127.0.0.1', userAgent: 'demo-seed' });
  }
  console.log('[seed] synchronized audit history');
}

async function seedRequests(assetUser, assets) {
  const requestableAsset = assets.find((asset) => asset.assetTag === 'AST-DEMO-001');
  await AssetRequest.findOneAndUpdate(
    { requester: assetUser._id, asset: requestableAsset._id },
    { $setOnInsert: { requester: assetUser._id, asset: requestableAsset._id, status: 'pending', note: 'Seeded demo request for a ready-to-deploy laptop' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log('[seed] synchronized asset requests');
}

async function seed() {
  await connectDB();
  const email = (process.env.SEED_EMAIL || 'superadmin@gmail.com').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'super@123';
  const name = process.env.SEED_NAME || 'Super Admin';

  let admin = await User.findOne({ email }).select('+password');
  if (!admin) {
    admin = await User.create({ name, email, password, role: 'superadmin' });
    console.log(`[seed] created superadmin: ${email} / ${password}`);
  } else {
    admin.name = name;
    admin.password = password;
    admin.role = 'superadmin';
    admin.active = true;
    await admin.save();
    console.log(`[seed] using existing superadmin: ${email}`);
  }

  let assetUser = await User.findOne({ email: 'asset@gmail.com' }).select('+password');
  if (!assetUser) {
    assetUser = await User.create({ name: 'Asset User', email: 'asset@gmail.com', password: 'asset@123', role: 'asset_user' });
    console.log('[seed] created asset user: asset@gmail.com / asset@123');
  } else {
    assetUser.password = 'asset@123';
    assetUser.active = true;
    assetUser.role = 'asset_user';
    await assetUser.save();
    console.log('[seed] using existing asset user: asset@gmail.com');
  }

  await seedRequirements();
  const assets = await seedAssets(admin);
  await seedAssignments(admin, assetUser, assets);
  await seedMaintenance(admin, assets);
  await seedInventory(admin, assetUser, assets[1]);
  await seedRequests(assetUser, assets);
  await seedAudit(admin, assets);
  await mongoose.disconnect();
  console.log('[seed] demo dataset is ready');
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
