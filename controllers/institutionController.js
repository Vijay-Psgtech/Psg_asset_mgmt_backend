const Institution = require('../models/Institutions');
const { ValidationError, ConflictError } = require('../utils/errors');

exports.list = async (req, res, next) => {
  try {
    const institutions = await Institution.find({ active: true }).sort({ name: 1 });
    res.json({ institutions });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2) throw new ValidationError('Institution name must be at least 2 characters');
    if (await Institution.exists({ name })) throw new ConflictError('An institution with this name already exists');

    const institution = await Institution.create({
      name,
      description: typeof req.body.description === 'string' ? req.body.description.trim() : '',
    });
    res.status(201).json({ institution });
  } catch (error) {
    next(error);
  }
};