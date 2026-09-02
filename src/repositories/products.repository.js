import { toProductDetail, toProductSummary } from '../lib/product-dto.js';

const PRODUCT_COLUMNS = `
  p.id, p.title, p.description, p.brand, p.sku, p.price, p.discount_percentage, p.rating, p.stock,
  p.weight, p.width, p.height, p.depth, p.warranty_information, p.shipping_information,
  p.availability_status, p.return_policy, p.minimum_order_quantity, p.barcode, p.qr_code, p.thumbnail,
  p.source_created_at, p.source_updated_at,
  c.slug AS category_slug, c.name AS category_name`;

const FROM_PRODUCTS = `FROM products p JOIN categories c ON c.id = p.category_id`;

function groupBy(rows, key, pick) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(pick(row));
    map.set(row[key], list);
  }
  return map;
}

export function createProductsRepository(pool) {
  async function loadRelations(productIds, { withReviews = false } = {}) {
    if (productIds.length === 0) return { images: new Map(), tags: new Map(), reviews: new Map() };

    const [imageRows] = await pool.query(
      `SELECT product_id, url FROM product_images WHERE product_id IN (?) ORDER BY product_id, position`,
      [productIds],
    );
    const [tagRows] = await pool.query(
      `SELECT pt.product_id, t.name
         FROM product_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.product_id IN (?)
        ORDER BY pt.product_id, pt.position`,
      [productIds],
    );
    let reviewRows = [];
    if (withReviews) {
      [reviewRows] = await pool.query(
        `SELECT product_id, rating, comment, reviewer_name, reviewer_email, reviewed_at
           FROM product_reviews WHERE product_id IN (?) ORDER BY product_id, position`,
        [productIds],
      );
    }
    return {
      images: groupBy(imageRows, 'product_id', (r) => r.url),
      tags: groupBy(tagRows, 'product_id', (r) => r.name),
      reviews: groupBy(reviewRows, 'product_id', (r) => r),
    };
  }

  return {
    /**
     * Paginated listing ordered by id, optionally filtered by category slug.
     * @returns {{ items: object[], total: number }}
     */
    async findPage({ page, limit, category }) {
      const where = category ? 'WHERE c.slug = ?' : '';
      const filterParams = category ? [category] : [];
      const offset = (page - 1) * limit;

      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total ${FROM_PRODUCTS} ${where}`,
        filterParams,
      );
      if (Number(total) === 0 || offset >= Number(total)) return { items: [], total: Number(total) };

      const [rows] = await pool.query(
        `SELECT ${PRODUCT_COLUMNS} ${FROM_PRODUCTS} ${where} ORDER BY p.id ASC LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset],
      );
      const rel = await loadRelations(rows.map((r) => r.id));
      return {
        items: rows.map((row) =>
          toProductSummary(row, { images: rel.images.get(row.id) ?? [], tags: rel.tags.get(row.id) ?? [] }),
        ),
        total: Number(total),
      };
    },

    /** Full product (with reviews) or null. */
    async findById(id) {
      const [rows] = await pool.query(`SELECT ${PRODUCT_COLUMNS} ${FROM_PRODUCTS} WHERE p.id = ?`, [id]);
      if (rows.length === 0) return null;
      const row = rows[0];
      const rel = await loadRelations([row.id], { withReviews: true });
      return toProductDetail(row, {
        images: rel.images.get(row.id) ?? [],
        tags: rel.tags.get(row.id) ?? [],
        reviews: rel.reviews.get(row.id) ?? [],
      });
    },

    /**
     * Streams every product as a full detail DTO in id order, in batches, for
     * indexing. Keyset pagination so it scales past the toy dataset.
     */
    async *iterateAllDetailed({ batchSize = 500 } = {}) {
      let lastId = 0;
      for (;;) {
        const [rows] = await pool.query(
          `SELECT ${PRODUCT_COLUMNS} ${FROM_PRODUCTS} WHERE p.id > ? ORDER BY p.id ASC LIMIT ?`,
          [lastId, batchSize],
        );
        if (rows.length === 0) return;
        const rel = await loadRelations(
          rows.map((r) => r.id),
          { withReviews: true },
        );
        for (const row of rows) {
          yield toProductDetail(row, {
            images: rel.images.get(row.id) ?? [],
            tags: rel.tags.get(row.id) ?? [],
            reviews: rel.reviews.get(row.id) ?? [],
          });
        }
        lastId = rows[rows.length - 1].id;
      }
    },
  };
}
