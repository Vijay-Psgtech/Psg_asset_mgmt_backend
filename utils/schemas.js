const { z } = require('zod');
const { CATEGORIES, STATUSES } = require('../models/Asset');
const { TYPES: MAINT_TYPES, STATUSES: MAINT_STATUSES } = require('../models/MaintenanceRecord');
const customFieldTypes = ['text', 'textarea', 'number', 'date', 'checkbox', 'select'];

const nullableOptionalId = z.union([
  z.string().trim().min(1),
  z.null(),
  z.literal(''),
]).optional().transform((value) => (value === '' ? null : value));

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(['asset_user', 'admin', 'superadmin']).optional(),
  institutionId: nullableOptionalId,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  institutionId: nullableOptionalId,
});

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(['asset_user', 'admin', 'superadmin']).optional(),
  institutionId: nullableOptionalId,
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  password: z.string().min(8).max(128),
});

const createAssetSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  institutionId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/).optional(),
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
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const customFieldIdParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/),
});

const customFieldListQuerySchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
});

const customFieldShape = {
  label: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
  type: z.enum(customFieldTypes),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
  categories: z.array(z.string().trim().min(1).max(80)).min(1).max(100),
  required: z.boolean().optional().default(false),
};

const customFieldDefinitionSchema = z.object(customFieldShape);
const validateCustomFieldDefinition = (schema) => schema.superRefine((field, context) => {
  if (field.type === 'select' && !field.options.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Select fields need at least one option' });
  }
  if (field.type !== 'select' && field.options.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Options are only supported for select fields' });
  }
});
const createCustomFieldSchema = validateCustomFieldDefinition(customFieldDefinitionSchema);
const updateCustomFieldSchema = validateCustomFieldDefinition(customFieldDefinitionSchema);

const assetIdParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/),
});

const assetTagParamSchema = z.object({
  tag: z.string().trim().min(1).max(128),
});

const assetListQuerySchema = z.object({
  search: z.string().trim().max(120).optional().or(z.literal('')),
  category: z.string().trim().max(80).optional().or(z.literal('')),
  status: z.enum(['all', ...STATUSES]).optional().or(z.literal('')),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.string().max(80).optional(),
});

const updateAssetSchema = createAssetSchema.partial().omit({ institutionId: true });

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

const accessoryCheckoutSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().or(z.literal('')).optional(),
  department: z.string().trim().max(120).optional(),
  quantity: z.coerce.number().int().min(1).optional().default(1),
  notes: z.string().trim().max(1000).optional(),
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
  createUserSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createAssetSchema,
  customFieldIdParamSchema,
  customFieldListQuerySchema,
  createCustomFieldSchema,
  updateCustomFieldSchema,
  assetIdParamSchema,
  assetTagParamSchema,
  assetListQuerySchema,
  updateAssetSchema,
  createAssignmentSchema,
  returnAssignmentSchema,
  accessoryCheckoutSchema,
  createMaintenanceSchema,
  updateMaintenanceSchema,
};
