import { Router } from 'express';

export function healthRouter(healthService) {
  const router = Router();

  router.get('/', async (req, res) => {
    const report = await healthService.check();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  return router;
}
