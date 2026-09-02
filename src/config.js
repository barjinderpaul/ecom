import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables and is validated
 * once at startup, so a misconfigured deployment fails immediately with a
 * readable message instead of at the first request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MYSQL_HOST: z.string().min(1).default('localhost'),
  MYSQL_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  MYSQL_USER: z.string().min(1).default('app'),
  MYSQL_PASSWORD: z.string().default('app'),
  MYSQL_DATABASE: z.string().min(1).default('ecommerce'),

  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().min(1).default('products'),

  DATA_SOURCE_URL: z.url().default('https://dummyjson.com'),
  SEED_FALLBACK_TO_SNAPSHOT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return result.data;
}

export const config = loadConfig();
