import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { categoriesRouter } from './routes/categories.js';
import { healthRouter } from './routes/health.js';
import { productsRouter } from './routes/products.js';

export function createApp({ productsService, categoriesService, healthService, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ methods: ['GET', 'HEAD', 'OPTIONS'] }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  app.use('/health', healthRouter(healthService));
  app.use('/categories', categoriesRouter(categoriesService));
  app.use('/products', productsRouter(productsService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
