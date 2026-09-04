import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi.js';

export function docsRouter() {
  const router = Router();
  router.get('/openapi.json', (req, res) => res.json(openApiDocument));
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: 'E-commerce API' }),
  );
  return router;
}
