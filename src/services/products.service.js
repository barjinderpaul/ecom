import { NotFoundError, ValidationError } from '../lib/errors.js';
import { MAX_RESULT_WINDOW } from '../search/products-index.js';

export function createProductsService({ productsRepository, productsSearch }) {
  return {
    /**
     * Listing is served by MySQL. When a free-text query is present the
     * request goes to Elasticsearch instead, with the category applied as a
     * filter so both parameters can be combined.
     */
    async list({ page, limit, category, query }) {
      if (query === undefined) {
        const { items, total } = await productsRepository.findPage({ page, limit, category });
        return { items, total, source: 'mysql' };
      }

      const from = (page - 1) * limit;
      if (from + limit > MAX_RESULT_WINDOW) {
        throw new ValidationError(`Search results are limited to the first ${MAX_RESULT_WINDOW} matches`, [
          { path: 'page', message: `page * limit must not exceed ${MAX_RESULT_WINDOW}` },
        ]);
      }
      const { items, total } = await productsSearch.search({ query, category, from, size: limit });
      return { items, total, source: 'elasticsearch' };
    },

    async getById(id) {
      const product = await productsRepository.findById(id);
      if (!product) throw new NotFoundError(`Product ${id} not found`);
      return product;
    },
  };
}
