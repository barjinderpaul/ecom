import { buildSearchBody } from './products-index.js';

export function createProductsSearch({ client, index }) {
  return {
    async search({ query, category, from, size }) {
      const response = await client.search({ index, ...buildSearchBody({ query, category, from, size }) });
      return {
        items: response.hits.hits.map((hit) => hit._source),
        total: response.hits.total.value,
      };
    },
  };
}
