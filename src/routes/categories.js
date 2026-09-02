import { Router } from 'express';

export function categoriesRouter(categoriesService) {
  const router = Router();

  router.get('/', async (req, res) => {
    const categories = await categoriesService.list();
    res.json({ data: categories });
  });

  return router;
}
