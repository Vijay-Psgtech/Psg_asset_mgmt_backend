const { z } = require('zod');
const { CATEGORIES, STATUSES } = require('../models/Asset');
const { TYPES: MAINT_TYPES, STATUSES: MAINT_STATUSES } = require('../models/MaintenanceRecord');

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(['asset_user', 'admin', 'superadmin']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createAssetSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(CATEGORIES),
  brand: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  serialNumber: z.string().max(120).optional(),
  status: z.enum(STATUSES).optional(),
  purchaseDate: z.string().datetime().optional().or(z.literal('')),
  purchaseCost: z.number().nonnegative().optional(),
  vendor: z.string().max(120).optional(),
  warrantyExpiry: z.string().datetime().optional().or(z.literal('')),
  location: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

const updateAssetSchema = createAssetSchema.partial();

const createAssignmentSchema = z.object({
  asset: z.string().min(1),
  assignedTo: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().optional().or(z.literal('')),
    department: z.string().max(120).optional(),
  }),
  conditionOnAssign: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

const returnAssignmentSchema = z.object({
  conditionOnReturn: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

const createMaintenanceSchema = z.object({
  asset: z.string().min(1),
  type: z.enum(MAINT_TYPES),
  description: z.string().min(1).max(2000),
  cost: z.number().nonnegative().optional(),
  vendor: z.string().max(120).optional(),
  scheduledDate: z.string().datetime().optional().or(z.literal('')),
  completedDate: z.string().datetime().optional().or(z.literal('')),
  status: z.enum(MAINT_STATUSES).optional(),
  performedBy: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});          

const updateMaintenanceSchema = createMaintenanceSchema.partial().omit({ asset: true });

module.exports = {
  registerSchema,
  loginSchema,
  createAssetSchema,
  updateAssetSchema,
  createAssignmentSchema,
  returnAssignmentSchema,
  createMaintenanceSchema,
  updateMaintenanceSchema,
};
