const INSERT_CHUNK = 500;

function chunk(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/**
 * Write side of the catalogue, used only by the seed. Every method runs on the
 * connection it is given so the caller controls the transaction boundary.
 */
export function createCatalogWriter(connection) {
  async function insertRows(sql, rows) {
    for (const part of chunk(rows, INSERT_CHUNK)) {
      await connection.query(sql, [part]);
    }
  }

  return {
    /** @returns {Map<string, number>} slug -> id */
    async upsertCategories(categories) {
      if (categories.length === 0) return new Map();
      await insertRows(
        `INSERT INTO categories (slug, name) VALUES ? AS new
         ON DUPLICATE KEY UPDATE name = new.name`,
        categories.map((c) => [c.slug, c.name]),
      );
      const [rows] = await connection.query(`SELECT id, slug FROM categories WHERE slug IN (?)`, [
        categories.map((c) => c.slug),
      ]);
      return new Map(rows.map((r) => [r.slug, r.id]));
    },

    /** @returns {Map<string, number>} lower-cased tag name -> id */
    async upsertTags(names) {
      if (names.length === 0) return new Map();
      await insertRows(
        `INSERT INTO tags (name) VALUES ? AS new
         ON DUPLICATE KEY UPDATE name = new.name`,
        names.map((name) => [name]),
      );
      const [rows] = await connection.query(`SELECT id, name FROM tags WHERE name IN (?)`, [names]);
      return new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
    },

    async upsertProducts(products) {
      if (products.length === 0) return;
      await insertRows(
        `INSERT INTO products (
           id, category_id, title, description, brand, sku, price, discount_percentage, rating, stock,
           weight, width, height, depth, warranty_information, shipping_information, availability_status,
           return_policy, minimum_order_quantity, barcode, qr_code, thumbnail, source_created_at, source_updated_at
         ) VALUES ? AS new
         ON DUPLICATE KEY UPDATE
           category_id = new.category_id, title = new.title, description = new.description, brand = new.brand,
           sku = new.sku, price = new.price, discount_percentage = new.discount_percentage, rating = new.rating,
           stock = new.stock, weight = new.weight, width = new.width, height = new.height, depth = new.depth,
           warranty_information = new.warranty_information, shipping_information = new.shipping_information,
           availability_status = new.availability_status, return_policy = new.return_policy,
           minimum_order_quantity = new.minimum_order_quantity, barcode = new.barcode, qr_code = new.qr_code,
           thumbnail = new.thumbnail, source_created_at = new.source_created_at,
           source_updated_at = new.source_updated_at`,
        products.map((p) => [
          p.id,
          p.categoryId,
          p.title,
          p.description,
          p.brand,
          p.sku,
          p.price,
          p.discountPercentage,
          p.rating,
          p.stock,
          p.weight,
          p.width,
          p.height,
          p.depth,
          p.warrantyInformation,
          p.shippingInformation,
          p.availabilityStatus,
          p.returnPolicy,
          p.minimumOrderQuantity,
          p.barcode,
          p.qrCode,
          p.thumbnail,
          p.sourceCreatedAt,
          p.sourceUpdatedAt,
        ]),
      );
    },

    /** Child rows are derived data: replace them wholesale for the given products. */
    async replaceProductImages(productIds, rows) {
      if (productIds.length === 0) return;
      await connection.query(`DELETE FROM product_images WHERE product_id IN (?)`, [productIds]);
      if (rows.length > 0) {
        await insertRows(
          `INSERT INTO product_images (product_id, position, url) VALUES ?`,
          rows.map((r) => [r.productId, r.position, r.url]),
        );
      }
    },

    async replaceProductTags(productIds, rows) {
      if (productIds.length === 0) return;
      await connection.query(`DELETE FROM product_tags WHERE product_id IN (?)`, [productIds]);
      if (rows.length > 0) {
        await insertRows(
          `INSERT INTO product_tags (product_id, tag_id, position) VALUES ?`,
          rows.map((r) => [r.productId, r.tagId, r.position]),
        );
      }
    },

    async replaceProductReviews(productIds, rows) {
      if (productIds.length === 0) return;
      await connection.query(`DELETE FROM product_reviews WHERE product_id IN (?)`, [productIds]);
      if (rows.length > 0) {
        await insertRows(
          `INSERT INTO product_reviews (product_id, rating, comment, reviewer_name, reviewer_email, reviewed_at) VALUES ?`,
          rows.map((r) => [r.productId, r.rating, r.comment, r.reviewerName, r.reviewerEmail, r.reviewedAt]),
        );
      }
    },

    /** Removes products that no longer exist upstream; child rows cascade. */
    async deleteProductsNotIn(productIds) {
      if (productIds.length === 0) {
        const [result] = await connection.query(`DELETE FROM products`);
        return result.affectedRows;
      }
      const [result] = await connection.query(`DELETE FROM products WHERE id NOT IN (?)`, [productIds]);
      return result.affectedRows;
    },

    async deleteOrphanTags() {
      const [result] = await connection.query(
        `DELETE t FROM tags t LEFT JOIN product_tags pt ON pt.tag_id = t.id WHERE pt.tag_id IS NULL`,
      );
      return result.affectedRows;
    },

    async deleteUnusedCategoriesNotIn(slugs) {
      const notIn = slugs.length > 0 ? 'AND c.slug NOT IN (?)' : '';
      const [result] = await connection.query(
        `DELETE c FROM categories c LEFT JOIN products p ON p.category_id = c.id WHERE p.id IS NULL ${notIn}`,
        slugs.length > 0 ? [slugs] : [],
      );
      return result.affectedRows;
    },
  };
}
