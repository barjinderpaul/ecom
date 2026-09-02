import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { listProductsQuerySchema, productIdParamsSchema } from './schemas.js';

export function productsRouter(productsService) {
  const router = Router();

  router.get('/', validate(listProductsQuerySchema, 'query'), async (req, res) => {
    const { page, limit, category, query } = res.locals.query;
    const { items, total, source } = await productsService.list({ page, limit, category, query });
    const meta = { source };
    if (query !== undefined) meta.query = query;
    if (category !== undefined) meta.category = category;
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
