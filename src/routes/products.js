import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { FILTER_KEYS, listProductsQuerySchema, productIdParamsSchema } from './schemas.js';

export function productsRouter(productsService) {
  const router = Router();

  router.get('/', validate(listProductsQuerySchema, 'query'), async (req, res) => {
    const { page, limit, query } = res.locals.query;
    const filters = Object.fromEntries(
      FILTER_KEYS.filter((key) => res.locals.query[key] !== undefined).map((key) => [
        key,
        res.locals.query[key],
      ]),
    );
    const { items, total, source } = await productsService.list({ page, limit, query, filters });
    const meta = { source, ...(query !== undefined && { query }), ...filters };
    res.json({
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      meta,
    });
  });

  router.get('/:id', validate(productIdParamsSchema, 'params'), async (req, res) => {
    const product = await productsService.getById(res.locals.params.id);
    res.json({ data: product });
  });

  return router;
}
