/**
 * Index definition for product documents. The document shape is exactly the
 * product detail DTO (see lib/product-dto.js), so search hits are returned to
 * clients without any further mapping.
 */

export const MAX_RESULT_WINDOW = 10_000;

export const productsIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  max_result_window: MAX_RESULT_WINDOW,
  analysis: {
    filter: {
      english_stop: { type: 'stop', stopwords: '_english_' },
      english_stemmer: { type: 'stemmer', language: 'english' },
      english_possessive_stemmer: { type: 'stemmer', language: 'possessive_english' },
      // Applied at search time only, so the list can grow without a reindex.
      product_synonyms: {
        type: 'synonym_graph',
        synonyms: [
          'phone, smartphone, mobile, cellphone',
          'laptop, notebook',
          'tv, television',
          'sneakers, trainers, running shoes',
          'fragrance, perfume, scent',
          'handbag, purse',
          'earbuds, earphones, headphones',
        ],
      },
    },
    analyzer: {
      product_text: {
        type: 'custom',
        tokenizer: 'standard',
        filter: [
          'english_possessive_stemmer',
          'lowercase',
          'asciifolding',
          'english_stop',
          'english_stemmer',
        ],
      },
      product_search: {
        type: 'custom',
        tokenizer: 'standard',
        filter: [
          'english_possessive_stemmer',
          'lowercase',
          'asciifolding',
          'product_synonyms',
          'english_stop',
          'english_stemmer',
        ],
      },
    },
    normalizer: {
      lowercase_normalizer: { type: 'custom', filter: ['lowercase', 'asciifolding'] },
    },
  },
};

const text = { type: 'text', analyzer: 'product_text', search_analyzer: 'product_search' };
const keyword = { type: 'keyword' };
const storedOnly = { type: 'keyword', index: false, doc_values: false };
const twoDecimals = { type: 'scaled_float', scaling_factor: 100 };

export const productsIndexMappings = {
  dynamic: 'strict',
  properties: {
    id: { type: 'integer' },
    title: {
      ...text,
      fields: {
        keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' },
        // Edge n-grams plus 2- and 3-word shingles for search-as-you-type on titles.
        prefix: { type: 'search_as_you_type', analyzer: 'product_text' },
      },
    },
    description: text,
    category: { ...keyword, fields: { text } },
    categoryName: text,
    brand: { ...text, fields: { keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' } } },
    sku: keyword,
    price: twoDecimals,
    discountPercentage: twoDecimals,
    rating: twoDecimals,
    stock: { type: 'integer' },
    tags: { ...keyword, fields: { text } },
    weight: { type: 'float' },
    dimensions: {
      properties: {
        width: { type: 'float' },
        height: { type: 'float' },
        depth: { type: 'float' },
      },
    },
    warrantyInformation: keyword,
    shippingInformation: keyword,
    availabilityStatus: keyword,
    returnPolicy: keyword,
    minimumOrderQuantity: { type: 'integer' },
    thumbnail: storedOnly,
    images: storedOnly,
    meta: {
      properties: {
        barcode: keyword,
        qrCode: storedOnly,
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
      },
    },
    reviews: {
      type: 'nested',
      properties: {
        rating: { type: 'byte' },
        comment: text,
        date: { type: 'date' },
        reviewerName: keyword,
        reviewerEmail: storedOnly,
      },
    },
  },
};

export const SEARCH_FIELDS = [
  'title^3',
  'brand^2',
  'tags.text^2',
  'sku^2',
  'category.text',
  'categoryName',
  'description',
];

export const PREFIX_FIELDS = ['title.prefix', 'title.prefix._2gram', 'title.prefix._3gram'];

export function buildFilters(filters = {}) {
  const clauses = [];
  if (filters.category !== undefined) clauses.push({ term: { category: filters.category } });
  if (filters.minRating !== undefined) clauses.push({ range: { rating: { gte: filters.minRating } } });
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const range = {};
    if (filters.minPrice !== undefined) range.gte = filters.minPrice;
    if (filters.maxPrice !== undefined) range.lte = filters.maxPrice;
    clauses.push({ range: { price: range } });
  }
  return clauses;
}

/**
 * Full-text search over product attributes. Reviews are stored but
 * deliberately not searched: a query like "great" would otherwise match
 * nearly every product through its review comments. Filters are unscored
 * `filter` clauses, so they are cached and do not disturb ranking.
 */
export function buildSearchBody({ query, filters, from, size }) {
  const body = {
    from,
    size,
    track_total_hits: true,
    _source: { excludes: ['reviews'] },
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query,
              type: 'best_fields',
              operator: 'or',
              fuzziness: 'AUTO',
              prefix_length: 1,
              fields: SEARCH_FIELDS,
            },
          },
        ],
        should: [
          {
            multi_match: {
              query,
              type: 'phrase',
              slop: 1,
              fields: ['title^2', 'description'],
            },
          },
          {
            multi_match: {
              query,
              type: 'bool_prefix',
              fields: PREFIX_FIELDS,
            },
          },
        ],
      },
    },
    sort: [{ _score: 'desc' }, { id: 'asc' }],
  };
  const filter = buildFilters(filters);
  if (filter.length > 0) body.query.bool.filter = filter;
  return body;
}
