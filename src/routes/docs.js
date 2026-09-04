import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi.js';

/** The document names the origin it was served from, so "Try it out" targets the right host and port. */
function documentFor(req) {
  return {
    ...openApiDocument,
    servers: [{ url: `${req.protocol}://${req.get('host')}`, description: 'this instance' }],
  };
}

export function docsRouter() {
  const router = Router();
  router.get('/openapi.json', (req, res) => res.json(documentFor(req)));
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(null, { customSiteTitle: 'E-commerce API', swaggerOptions: { url: '/openapi.json' } }),
  );
  return router;
}
