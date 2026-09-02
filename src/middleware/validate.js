import { ValidationError } from '../lib/errors.js';

/**
 * Validates req[source] with a zod schema and exposes the parsed value on
 * res.locals[source]. Express 5 defines req.query as a getter, so the parsed
 * value is never written back onto the request.
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
