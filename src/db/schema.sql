-- Idempotent: every statement is CREATE TABLE IF NOT EXISTS so the seed can be re-run.
-- Upstream (dummyjson) ids are kept as primary keys so /products/{id} matches the source.

CREATE TABLE IF NOT EXISTS categories (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id                     INT UNSIGNED  NOT NULL,
  category_id            INT UNSIGNED  NOT NULL,
  title                  VARCHAR(255)  NOT NULL,
  description            TEXT          NOT NULL,
  brand                  VARCHAR(100)  NULL,
  sku                    VARCHAR(64)   NOT NULL,
  price                  DECIMAL(12,2) NOT NULL,
  discount_percentage    DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  rating                 DECIMAL(3,2)  NOT NULL DEFAULT 0.00,
  stock                  INT UNSIGNED  NOT NULL DEFAULT 0,
  weight                 DECIMAL(10,2) NULL,
  width                  DECIMAL(10,2) NULL,
  height                 DECIMAL(10,2) NULL,
  depth                  DECIMAL(10,2) NULL,
  warranty_information   VARCHAR(255)  NULL,
  shipping_information   VARCHAR(255)  NULL,
  availability_status    VARCHAR(50)   NOT NULL DEFAULT 'In Stock',
  return_policy          VARCHAR(255)  NULL,
  minimum_order_quantity INT UNSIGNED  NOT NULL DEFAULT 1,
  barcode                VARCHAR(64)   NULL,
  qr_code                VARCHAR(1024) NULL,
  thumbnail              VARCHAR(1024) NULL,
  source_created_at      DATETIME(3)   NULL,
  source_updated_at      DATETIME(3)   NULL,
  created_at             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category_id (category_id, id),
  KEY idx_products_price (price),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT chk_products_discount CHECK (discount_percentage BETWEEN 0 AND 100),
  CONSTRAINT chk_products_rating CHECK (rating BETWEEN 0 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_images (
  id         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  product_id INT UNSIGNED     NOT NULL,
  position   TINYINT UNSIGNED NOT NULL,
  url        VARCHAR(1024)    NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_images_position (product_id, position),
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tags (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_tags (
  product_id INT UNSIGNED     NOT NULL,
  tag_id     INT UNSIGNED     NOT NULL,
  position   TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (product_id, tag_id),
  KEY idx_product_tags_tag (tag_id),
  CONSTRAINT fk_product_tags_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_product_tags_tag     FOREIGN KEY (tag_id)     REFERENCES tags (id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_reviews (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  product_id     INT UNSIGNED     NOT NULL,
  rating         TINYINT UNSIGNED NOT NULL,
  comment        TEXT             NULL,
  reviewer_name  VARCHAR(255)     NOT NULL,
  reviewer_email VARCHAR(255)     NOT NULL,
  reviewed_at    DATETIME(3)      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_product_reviews_product (product_id, reviewed_at),
  CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT chk_product_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
