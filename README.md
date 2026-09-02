# E-commerce API

A small product catalogue REST API built with Node.js 22, Express 5, MySQL 8 and Elasticsearch 8.
The catalogue is seeded from [dummyjson.com/products](https://dummyjson.com/products): products, categories,
images, tags and reviews are stored relationally in MySQL and indexed for full-text search in Elasticsearch.

## Running it

Requirements: Docker with Compose v2. Nothing else needs to be installed.

```sh
docker compose up --build
```

Startup order is enforced with health checks: MySQL and Elasticsearch come up first, the `seed` container fetches
the data, writes MySQL, builds the search index and exits, and only then does the `api` container start on
<http://localhost:3000>. The first run downloads about 3 GB of images and takes a few minutes; later runs
take under a minute. Every container has a memory limit (Elasticsearch 1.25 GB, MySQL 512 MB, seed and API
256 MB each), so the whole stack stays under about 2.3 GB. MySQL and Elasticsearch are also published, on
`127.0.0.1:3307` and `127.0.0.1:9201`, so they never collide with instances you may already run locally.

On a Linux host without Docker Desktop, Elasticsearch may need `sudo sysctl -w vm.max_map_count=262144` once.

```sh
curl 'http://localhost:3000/health'
curl 'http://localhost:3000/categories'
curl 'http://localhost:3000/products?limit=5'
curl 'http://localhost:3000/products/1'
curl 'http://localhost:3000/products?query=mascara'
curl 'http://localhost:3000/products?category=smartphones'
curl 'http://localhost:3000/products?query=phone&category=smartphones&page=1&limit=10'
```

Useful commands:

| Command                        | What it does                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `docker compose down`          | Stops the stack, keeps the data volumes                                |
| `docker compose down -v`       | Stops the stack and deletes the data (required after schema edits)     |
| `docker compose run --rm seed` | Re-fetches the data and rebuilds MySQL and the search index            |
| `npm run smoke`                | Runs end-to-end checks against a running stack (`API_URL` to override) |

Ports and credentials can be overridden by copying `.env.example` to `.env`; every value has a default.

### Without Docker

You need MySQL 8 and Elasticsearch 8 reachable from your machine (the compose services work: start them with
`docker compose up mysql elasticsearch` and use the ports below), then:

```sh
npm ci
MYSQL_PORT=3307 ELASTICSEARCH_URL=http://localhost:9201 npm run seed   # tables, data, index
MYSQL_PORT=3307 ELASTICSEARCH_URL=http://localhost:9201 npm start      # or: npm run dev
```

Configuration is read from environment variables, validated at startup (`src/config.js`):

| Variable                        | Default                 |
| ------------------------------- | ----------------------- |
| `PORT`                          | `3000`                  |
| `MYSQL_HOST` / `MYSQL_PORT`     | `localhost` / `3306`    |
| `MYSQL_USER` / `MYSQL_PASSWORD` | `app` / `app`           |
| `MYSQL_DATABASE`                | `ecommerce`             |
| `ELASTICSEARCH_URL`             | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX`           | `products`              |
| `DATA_SOURCE_URL`               | `https://dummyjson.com` |
| `SEED_FALLBACK_TO_SNAPSHOT`     | `true`                  |
| `LOG_LEVEL`                     | `info`                  |

### Tests and linting

```sh
npm test            # unit and HTTP tests, no database needed
npm run lint        # eslint
npm run format:check
```

## API

| Endpoint                                     | Source        | Description                                            |
| -------------------------------------------- | ------------- | ------------------------------------------------------ |
| `GET /health`                                | both          | `200` when MySQL and Elasticsearch respond, else `503` |
| `GET /categories`                            | MySQL         | All categories with their product count, by name       |
| `GET /products`                              | MySQL         | Paginated list ordered by id                           |
| `GET /products?category={slug}`              | MySQL         | Same list filtered by category slug                    |
| `GET /products?query={text}`                 | Elasticsearch | Full-text search ordered by relevance                  |
| `GET /products?query={text}&category={slug}` | Elasticsearch | Search restricted to one category                      |
| `GET /products/{id}`                         | MySQL         | One product including its reviews                      |

Pagination parameters `page` (default 1) and `limit` (default 20, max 100) apply to every list. A page past the
end returns an empty `data` array, not an error. `category` is matched case-insensitively; an unknown category
yields an empty list. `query` is trimmed and limited to 200 characters; a blank `query` is treated as absent.

List responses:

```json
{
  "data": [
    { "id": 1, "title": "Essence Mascara Lash Princess", "category": "beauty", "price": 9.99, "...": "..." }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 194, "totalPages": 10 },
  "meta": { "source": "elasticsearch", "query": "mascara" }
}
```

A product carries the same fields from either store: `id`, `title`, `description`, `category`, `categoryName`,
`brand` (`null` when unknown), `sku`, `price`, `discountPercentage`, `rating`, `stock`, `tags`, `weight`,
`dimensions`, `warrantyInformation`, `shippingInformation`, `availabilityStatus`, `returnPolicy`,
`minimumOrderQuantity`, `thumbnail`, `images` and `meta` (`barcode`, `qrCode`, `createdAt`, `updatedAt`).
`GET /products/{id}` adds `reviews`.

Errors always have the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid query",
    "details": [{ "path": "limit", "message": "must be at most 100" }]
  }
}
```

| Status | Code                  | When                                                           |
| ------ | --------------------- | -------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`    | Malformed `page`, `limit`, `category`, `query` or `{id}`       |
| 404    | `NOT_FOUND`           | Unknown product id or route                                    |
| 503    | `SERVICE_UNAVAILABLE` | MySQL or Elasticsearch unreachable, or the index not built yet |
| 500    | `INTERNAL_ERROR`      | Anything else; details go to the log, not the client           |

## Design

### Code layout

```
src/
  app.js                 Express app factory (dependencies injected, so it is testable without infrastructure)
  server.js              Wires real MySQL/Elasticsearch clients, starts listening, graceful shutdown
  config.js              Environment variables validated with zod
  routes/                HTTP handlers and request schemas
  services/              Use cases: which store answers, pagination limits, 404s
  repositories/          MySQL reads (products, categories) and the seed's write path (catalog-writer)
  search/                Elasticsearch client, index definition, query builder, alias-swap indexer
  lib/product-dto.js     The single mapper from MySQL rows to the public product shape
  db/schema.sql          MySQL DDL
  scripts/seed.js        Fetch -> validate -> MySQL -> Elasticsearch
data/                    Snapshot of the upstream payload, used only if the live fetch fails
test/                    node:test suites (npm test)
scripts/smoke.js         End-to-end checks against a running stack (npm run smoke)
```

Requests flow routes -> services -> repositories or search. Routes only validate and shape HTTP; services decide
which store to use; repositories and the search module talk to their stores and return DTOs. One mapper,
`toProductDetail`, produces the product shape both when serving from MySQL and when building Elasticsearch
documents, so a product looks identical regardless of which store answered.

### MySQL schema

`db/schema.sql` normalises the upstream JSON into six tables:

- `categories` (`slug` unique) and `products` with a foreign key to it. The upstream product id is kept as the
  primary key so `/products/{id}` matches the source. `sku` is unique. `brand` is nullable because 92 of the 194
  upstream products have none; weight, dimensions, barcode, QR code and the upstream timestamps are nullable
  because they are metadata a product can legitimately lack; the merchandising attributes are `NOT NULL`.
- `product_images`, `product_tags` (through a `tags` lookup table, tags are shared across products) and
  `product_reviews`, each with a `position` column unique per product so upstream ordering is reproduced
  exactly. Child rows cascade on delete.
- Money and ratings are `DECIMAL`, not floats. Timestamps are `DATETIME(3)` stored in UTC (the pool is opened with
  `timezone: 'Z'`), so upstream ISO timestamps round-trip to the millisecond.
- `CHECK` constraints guard ranges (price and dimensions >= 0, rating 0..5, discount 0..100, review rating 1..5).
  Attributes that look enumerated (`availability_status`, `return_policy`) are `VARCHAR`, not `ENUM`, so new
  upstream values do not require an `ALTER TABLE`.
- Indexes match the read paths: the category-filtered list uses `(category_id, id)`, which also makes
  `ORDER BY id` a plain index walk; everything else is served by primary or unique keys.

### Elasticsearch index

`search/products-index.js` defines the index. The document is the full product DTO, including reviews, so a
search hit can be returned as-is (reviews are excluded from search responses via `_source`).

- `dynamic: strict`: a document with an unexpected field is rejected instead of silently creating a mapping.
  A unit test checks that every field the mapper produces is mapped.
- A custom `product_text` analyzer (possessive stemmer, lowercase, ASCII folding, English stop words, English
  stemmer) is applied to `title`, `description`, `brand`, `categoryName` and the `.text` sub-fields of
  `category` and `tags`. The base `category` and `tags` fields stay `keyword` for exact filtering.
- `price`, `discountPercentage` and `rating` are `scaled_float` (factor 100), which stores exact cents.
  URLs (`thumbnail`, `images`, `qrCode`) are stored but not indexed. Reviews are `nested`, so a future query
  such as "rating 5 by reviewer X" would not match across different reviews.
- The query is a `multi_match` (`best_fields`, `fuzziness: AUTO`) over `title^3`, `brand^2`, `tags^2`,
  category and description, plus a phrase clause that boosts exact phrases, with the category as a `filter`
  clause (unscored, cacheable). Results are sorted by score and then id for a stable order across pages.
  Review text is deliberately not searched: a query like "great" would otherwise match almost every product.
- The API reads through the alias `products`. The seed builds a fresh timestamped index, bulk-loads it, swaps
  the alias in one atomic call and deletes the previous index, so a rebuild is never observed half-done and a
  failed rebuild leaves the old index serving.

### Which store answers what

MySQL is the source of truth and serves the listing, the category filter and product detail: those are exact
queries with exact counts, and the database already has the indexes for them. Elasticsearch is used only when
`query` is present, because relevance ranking, stemming and typo tolerance are what it is for. The `meta.source`
field in list responses makes the choice visible. `query` and `category` can be combined, in which case the
category becomes a filter inside the search.

### Seed

`scripts/seed.js` is idempotent and is what runs in the `seed` container:

1. Fetches `/products?limit=0` and `/products/categories`, validating the payload with zod so shape drift
   upstream fails loudly rather than corrupting the database. If the fetch fails or the payload is unusable,
   it falls back to the snapshot in `data/` (disable with `SEED_FALLBACK_TO_SNAPSHOT=false`).
2. Waits for MySQL and Elasticsearch, then applies `schema.sql` (all `CREATE TABLE IF NOT EXISTS`).
3. In one transaction: upserts categories, tags and products (`INSERT ... AS new ON DUPLICATE KEY UPDATE`),
   replaces the derived child rows (images, tags, reviews), deletes products that disappeared upstream and
   prunes unreferenced tags and categories. Multi-row inserts are batched.
4. Reads every product back through the same repository the API uses and bulk-indexes it into a new
   Elasticsearch index, then swaps the alias.

### Other choices

- Express 5 over Fastify or NestJS: four read-only endpoints do not benefit from Fastify's throughput or Nest's
  structure, Express 5 propagates rejected promises to the error middleware natively, and it is the framework
  most reviewers can read without a primer. Validation is done with zod at the HTTP boundary.
- Plain JavaScript (ESM) rather than TypeScript keeps `docker compose up` free of a build step; zod provides
  runtime validation where it matters (configuration, requests, upstream data).
- The API never exposes internal errors. Infrastructure failures are mapped to `503` so clients can tell
  "retry later" from "bad request".
- The Docker image runs as the unprivileged `node` user, installs production dependencies only, and every
  container has a memory limit so the stack behaves on a laptop. Database and search ports are bound to
  loopback because Elasticsearch runs with security disabled.
- `docker compose up` a second time re-runs the seed (a few seconds); data volumes persist across restarts.

## Known limitations

- Read-only API. There is no authentication, rate limiting or response caching.
- Elasticsearch is only updated by the seed; there is no incremental sync from MySQL. Re-run the seed to refresh.
- Offset pagination only. Search pages are capped at the first 10,000 matches (`index.max_result_window`).
- Schema changes are not migrated: `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so after editing it run
  `docker compose down -v` before starting again.
- If upstream ever moves a SKU from one product id to another between two seeds, the products upsert fails on
  the unique key; the transaction rolls back and the seed exits non-zero. An upstream payload with zero
  products is also rejected rather than emptying the catalogue.
- Reviewers are stored per review (name and e-mail) because the upstream data has no reviewer ids to build a
  users table from.
- Elasticsearch runs as a single node with security disabled, which is appropriate for local development only.
- Search relevance was tuned by inspecting results, not measured against a labelled query set.
