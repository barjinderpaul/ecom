import { z } from 'zod';

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
  ELASTICSEARCH_INDEX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'must be a lowercase Elasticsearch index name')
    .default('products'),

  DATA_SOURCE_URL: z.url().default('https://dummyjson.com'),
  SEED_FALLBACK_TO_SNAPSHOT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  return result.data;
}

export const config = loadConfig();
