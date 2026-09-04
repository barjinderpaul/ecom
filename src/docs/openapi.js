const productFields = {
  id: { type: 'integer', example: 1 },
  title: { type: 'string', example: 'Essence Mascara Lash Princess' },
  description: { type: 'string' },
  category: { type: 'string', description: 'Category slug', example: 'beauty' },
  categoryName: { type: 'string', example: 'Beauty' },
  brand: { type: 'string', nullable: true, example: 'Essence' },
  sku: { type: 'string', example: 'BEA-ESS-ESS-001' },
  price: { type: 'number', example: 9.99 },
  discountPercentage: { type: 'number', example: 10.48 },
  rating: { type: 'number', minimum: 0, maximum: 5, example: 2.56 },
  stock: { type: 'integer', example: 99 },
  tags: { type: 'array', items: { type: 'string' }, example: ['beauty', 'mascara'] },
  weight: { type: 'number', nullable: true, example: 4 },
  dimensions: {
    type: 'object',
    properties: {
      width: { type: 'number', nullable: true },
      height: { type: 'number', nullable: true },
      depth: { type: 'number', nullable: true },
    },
  },
  warrantyInformation: { type: 'string', example: '1 week warranty' },
  shippingInformation: { type: 'string', example: 'Ships in 3-5 business days' },
  availabilityStatus: { type: 'string', example: 'In Stock' },
  returnPolicy: { type: 'string', example: 'No return policy' },
  minimumOrderQuantity: { type: 'integer', example: 48 },
  thumbnail: { type: 'string', format: 'uri' },
  images: { type: 'array', items: { type: 'string', format: 'uri' } },
  meta: {
    type: 'object',
    properties: {
      barcode: { type: 'string', nullable: true, example: '5784719087687' },
      qrCode: { type: 'string', nullable: true, format: 'uri' },
      createdAt: { type: 'string', nullable: true, format: 'date-time' },
      updatedAt: { type: 'string', nullable: true, format: 'date-time' },
    },
  },
};

const errorResponse = (description, code, message, details) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: { error: { code, message, ...(details ? { details } : {}) } },
    },
  },
});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'E-commerce API',
    version: '1.0.0',
    description:
      'Product catalogue seeded from dummyjson.com. Listing, category filtering and product detail are served ' +
      'from MySQL; free-text search is served from Elasticsearch. Requests are rate limited per client IP ' +
      '(HTTP 429 with a RateLimit header when exceeded).',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'products' }, { name: 'categories' }, { name: 'system' }],
  paths: {
    '/health': {
      get: {
        tags: ['system'],
        summary: 'Dependency health',
        responses: {
          200: {
            description: 'MySQL and Elasticsearch both respond',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: { status: 'ok', checks: { mysql: 'up', elasticsearch: 'up' } },
              },
            },
          },
          503: {
            description: 'At least one dependency is down',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: { status: 'degraded', checks: { mysql: 'up', elasticsearch: 'down' } },
              },
            },
          },
        },
      },
    },
    '/categories': {
      get: {
        tags: ['categories'],
        summary: 'List all categories with product counts',
        description:
          'Served from MySQL, ordered by name. Not paginated: the catalogue has a few dozen categories.',
        responses: {
          200: {
            description: 'Categories',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Category' } } },
                },
                example: { data: [{ slug: 'beauty', name: 'Beauty', productCount: 5 }] },
              },
            },
          },
          503: errorResponse('Database unavailable', 'SERVICE_UNAVAILABLE', 'Database is unavailable'),
        },
      },
    },
    '/products': {
      get: {
        tags: ['products'],
        summary: 'List, filter or search products',
        description:
          'Without `query` the list comes from MySQL ordered by id. With `query` it comes from Elasticsearch ' +
          'ordered by relevance (title, brand, tags, category and description are searched with typo tolerance). ' +
          'Filters apply on both paths and can be combined.',
        parameters: [
          {
            name: 'query',
            in: 'query',
            schema: { type: 'string', maxLength: 200 },
            description: 'Free-text search. Blank is treated as absent.',
            example: 'mascara',
          },
          {
            name: 'category',
            in: 'query',
            schema: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
            description: 'Category slug, matched case-insensitively. Unknown slugs return an empty list.',
            example: 'beauty',
          },
          {
            name: 'minRating',
            in: 'query',
            schema: { type: 'number', minimum: 0, maximum: 5 },
            description: 'Only products rated at least this value.',
            example: 4,
          },
          {
            name: 'minPrice',
            in: 'query',
            schema: { type: 'number', minimum: 0 },
            example: 10,
          },
          {
            name: 'maxPrice',
            in: 'query',
            schema: { type: 'number', minimum: 0 },
            description: 'Must not be lower than minPrice.',
            example: 100,
          },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          200: {
            description: 'A page of products',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProductPage' },
                example: {
                  data: [{ id: 1, title: 'Essence Mascara Lash Princess', category: 'beauty', price: 9.99 }],
                  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
                  meta: { source: 'elasticsearch', query: 'mascara' },
                },
              },
            },
          },
          400: errorResponse('Invalid parameter', 'VALIDATION_ERROR', 'Invalid query', [
            { path: 'limit', message: 'must be at most 100' },
          ]),
          503: errorResponse(
            'MySQL or Elasticsearch unavailable',
            'SERVICE_UNAVAILABLE',
            'Search backend is unavailable',
          ),
        },
      },
    },
    '/products/{id}': {
      get: {
        tags: ['products'],
        summary: 'Get one product with its reviews',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 4294967295 },
            example: 1,
          },
        ],
        responses: {
          200: {
            description: 'The product',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/Product' } },
                },
              },
            },
          },
          400: errorResponse('Malformed id', 'VALIDATION_ERROR', 'Invalid params', [
            { path: 'id', message: 'must be a positive integer' },
          ]),
          404: errorResponse('Unknown id', 'NOT_FOUND', 'Product 999 not found'),
          503: errorResponse('Database unavailable', 'SERVICE_UNAVAILABLE', 'Database is unavailable'),
        },
      },
    },
  },
  components: {
    schemas: {
      ProductSummary: { type: 'object', properties: productFields },
      Product: {
        type: 'object',
        properties: {
          ...productFields,
          reviews: { type: 'array', items: { $ref: '#/components/schemas/Review' } },
        },
      },
      Review: {
        type: 'object',
        properties: {
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string' },
          date: { type: 'string', format: 'date-time' },
          reviewerName: { type: 'string' },
          reviewerEmail: { type: 'string' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          slug: { type: 'string', example: 'beauty' },
          name: { type: 'string', example: 'Beauty' },
          productCount: { type: 'integer', example: 5 },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      ProductPage: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/ProductSummary' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
          meta: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: ['mysql', 'elasticsearch'] },
              query: { type: 'string' },
              category: { type: 'string' },
              minRating: { type: 'number' },
              minPrice: { type: 'number' },
              maxPrice: { type: 'number' },
            },
          },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          checks: { type: 'object', additionalProperties: { type: 'string', enum: ['up', 'down'] } },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'NOT_FOUND',
                  'RATE_LIMITED',
                  'SERVICE_UNAVAILABLE',
                  'BAD_REQUEST',
                  'INTERNAL_ERROR',
                ],
              },
              message: { type: 'string' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { path: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};
