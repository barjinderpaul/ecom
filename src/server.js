import { createApp } from './app.js';
import { config } from './config.js';
import { createPool, pingMysql } from './db/mysql.js';
import { logger } from './lib/logger.js';
import { createCategoriesRepository } from './repositories/categories.repository.js';
import { createProductsRepository } from './repositories/products.repository.js';
import { createSearchClient, pingSearch } from './search/client.js';
import { createProductsSearch } from './search/products-search.js';
import { createCategoriesService } from './services/categories.service.js';
import { createHealthService } from './services/health.service.js';
import { createProductsService } from './services/products.service.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const pool = createPool(config);
const searchClient = createSearchClient(config);

const app = createApp({
  logger,
  productsService: createProductsService({
    productsRepository: createProductsRepository(pool),
    productsSearch: createProductsSearch({ client: searchClient, index: config.ELASTICSEARCH_INDEX }),
  }),
  categoriesService: createCategoriesService({ categoriesRepository: createCategoriesRepository(pool) }),
  healthService: createHealthService({
    checks: {
      mysql: () => pingMysql(pool),
      elasticsearch: () => pingSearch(searchClient),
    },
  }),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

let shuttingDown = false;

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out; exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    await Promise.allSettled([pool.end(), searchClient.close()]);
    process.exit(exitCode);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});
