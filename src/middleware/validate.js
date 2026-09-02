import { ValidationError } from '../lib/errors.js';

/**
 * Validates req[source] against a zod schema. The parsed (coerced, defaulted)
 * value is exposed on res.locals[source] — Express 5 makes req.query a getter,
 * so we never try to overwrite it.
 */
export function validate(schema, source = 'query') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(new ValidationError(`Invalid ${source}`, details));
    }
    res.locals[source] = result.data;
    return next();
  };
}
