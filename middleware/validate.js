const { ValidationError } = require('../utils/errors');

/**
 * Wraps a zod schema so route handlers stay thin.
 * Usage: router.post('/', validate(createAssetSchema), controller.create)
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(new ValidationError('Request body failed validation', details));
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
