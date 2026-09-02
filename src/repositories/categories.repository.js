export function createCategoriesRepository(pool) {
  return {
    /** All categories with the number of products in each, alphabetical by name. */
    async findAllWithCounts() {
      const [rows] = await pool.query(
        `SELECT c.slug, c.name, COUNT(p.id) AS product_count
           FROM categories c
           LEFT JOIN products p ON p.category_id = c.id
          GROUP BY c.id, c.slug, c.name
          ORDER BY c.name ASC`,
      );
      return rows.map((r) => ({ slug: r.slug, name: r.name, productCount: Number(r.product_count) }));
    },
  };
}
