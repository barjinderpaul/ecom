import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { categoriesRouter } from './routes/categories.js';
import { docsRouter } from './routes/docs.js';
import { healthRouter } from './routes/health.js';
import { productsRouter } from './routes/products.js';

/**
 * @param {object} deps
 * @param {number} [deps.rateLimitPerMinute] requests per client IP per minute; 0 disables
 */
export function createApp({
  productsService,
  categoriesService,
  healthService,
  logger,
  rateLimitPerMinute = 0,
}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(cors({ methods: ['GET', 'HEAD', 'OPTIONS'] }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  if (rateLimitPerMinute > 0) {
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: rateLimitPerMinute,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        validate: { xForwardedForHeader: false },
        handler: (req, res) =>
          res
            .status(429)
            .json({ error: { code: 'RATE_LIMITED', message: 'Too many requests; retry later' } }),
      }),
    );
  }

  // Swagger UI needs inline scripts, so it gets helmet without a CSP; every other route gets the full set.
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }),
    docsRouter(),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use('/health', healthRouter(healthService));
  app.use('/categories', categoriesRouter(categoriesService));
  app.use('/products', productsRouter(productsService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
