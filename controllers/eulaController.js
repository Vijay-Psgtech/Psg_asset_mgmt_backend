const Eula = require('../models/Eula');
const Asset = require('../models/Asset');
const License = require('../models/License');
const { scopeInstitution } = require('../utils/institutionScope');
const { ForbiddenError, NotFoundError } = require('../utils/errors');

async function validateEulaReferences(updates, tenantScope) {
  if (updates.asset && !(await Asset.findOne({ _id: updates.asset, ...tenantScope }).select('_id'))) {
    throw new NotFoundError('Asset not found');
  }
  if (updates.license && !(await License.findOne({ _id: updates.license, ...tenantScope }).select('_id'))) {
    throw new NotFoundError('License not found');
  }
}

exports.list = async (req, res, next) => {
  try {
    const query = scopeInstitution(req, req.user.role === 'asset_user' ? { $or: [{ 'assignedTo.email': req.user.email }, { 'assignedTo.name': req.user.name }] } : {});
    const data = await Eula.find(query).populate('institution', 'name code').populate('asset', 'name assetTag').populate('license', 'name vendor').sort({ createdAt: -1 });
    res.json({ data });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const tenantScope = scopeInstitution(req, {});
    const institution = tenantScope.institution || req.body.institutionId || req.body.institution;
    if (!institution) throw new ForbiddenError('Select an institution before creating EULAs');

    const fields = ['title', 'vendor', 'license', 'asset', 'assignedTo', 'status', 'acceptedAt', 'expiresAt', 'documentUrl', 'notes'];
    const updates = Object.fromEntries(fields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    await validateEulaReferences(updates, { ...tenantScope, institution });
    res.status(201).json(await Eula.create({
      ...updates,
      institution,
      createdBy: req.user._id,
    }));
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const tenantScope = scopeInstitution(req, {});
    const editable = ['title', 'vendor', 'license', 'asset', 'assignedTo', 'status', 'acceptedAt', 'expiresAt', 'documentUrl', 'notes'];
    const updates = Object.fromEntries(editable.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    await validateEulaReferences(updates, tenantScope);
    const item = await Eula.findOneAndUpdate(
      { _id: req.params.id, ...tenantScope },
      updates,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'EULA not found' });
    res.json(item);
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await Eula.findOneAndDelete({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!item) return res.status(404).json({ message: 'EULA not found' });
    res.status(204).send();
  } catch (error) { next(error); }
};
