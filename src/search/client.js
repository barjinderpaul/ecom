import { Client } from '@elastic/elasticsearch';

export function createSearchClient(config) {
  return new Client({
    node: config.ELASTICSEARCH_URL,
    requestTimeout: 10_000,
    maxRetries: 2,
  });
}

export async function pingSearch(client) {
  const health = await client.cluster.health({ timeout: '2s' });
  if (health.status === 'red') throw new Error('Elasticsearch cluster status is red');
}
