import { z } from 'zod';

const MAX_UNSIGNED_INT = 4_294_967_295;

const isBlank = (value) => value === undefined || (typeof value === 'string' && value.trim() === '');
const blankToUndefined = (value) => (isBlank(value) ? undefined : value);

function integerParam({ min, max, fallback }) {
  return z.preprocess(
    (value) => (isBlank(value) ? String(fallback) : value),
    z
      .string({ error: 'must be a single value' })
      .trim()
      .regex(/^[0-9]{1,9}$/, 'must be a positive integer')
      .transform(Number)
      .pipe(z.number().int().min(min, `must be at least ${min}`).max(max, `must be at most ${max}`)),
  );
}

export const listProductsQuerySchema = z.object({
  page: integerParam({ min: 1, max: 1_000_000, fallback: 1 }),
  limit: integerParam({ min: 1, max: 100, fallback: 20 }),
  category: z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'must be a single value' })
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a category slug such as "mens-shoes"')
      .max(100)
      .optional(),
  ),
  query: z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'must be a single value' })
      .trim()
      .max(200, 'must be at most 200 characters')
      .optional(),
  ),
});

export const productIdParamsSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/, 'must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().max(MAX_UNSIGNED_INT, `must be at most ${MAX_UNSIGNED_INT}`)),
});
