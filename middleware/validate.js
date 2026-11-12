const { ValidationError } = require('../utils/errors');

/**
 * Wraps a zod schema so route handlers stay thin.
 * Usage:
 *   router.post('/', validate(createAssetSchema), controller.create)
 *   router.get('/:id', validate(assetIdParamSchema, 'params'), controller.getById)
 *   router.get('/', validate(assetListQuerySchema, 'query'), controller.list)
 */
function validate(schema, target = 'body') {
  return (req, res, next) => {
    const source = target === 'params' ? req.params : target === 'query' ? req.query : req.body;
    const result = schema.safeParse(source);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      return next(new ValidationError(`Request ${target} failed validation`, details));
    }

    if (target === 'params') {
      req.params = result.data;
    } else if (target === 'query') {
      req.query = result.data;
    } else {
      req.body = result.data;
    }

    next();
  };
}

module.exports = validate;
