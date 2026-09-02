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
    },
    normalizer: {
      lowercase_normalizer: { type: 'custom', filter: ['lowercase', 'asciifolding'] },
    },
  },
};

const text = { type: 'text', analyzer: 'product_text' };
const keyword = { type: 'keyword' };
const storedOnly = { type: 'keyword', index: false, doc_values: false };
const twoDecimals = { type: 'scaled_float', scaling_factor: 100 };

export const productsIndexMappings = {
  dynamic: 'strict',
  properties: {
    id: { type: 'integer' },
    title: { ...text, fields: { keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' } } },
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
  'category.text',
  'categoryName',
  'description',
];

/**
 * Full-text search over product attributes. Reviews are stored but
 * deliberately not searched: a query like "great" would otherwise match
 * nearly every product through its review comments.
 */
export function buildSearchBody({ query, category, from, size }) {
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
              max_expansions: 50,
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
        ],
      },
    },
    sort: [{ _score: 'desc' }, { id: 'asc' }],
  };
  if (category !== undefined) {
    body.query.bool.filter = [{ term: { category } }];
  }
  return body;
}
