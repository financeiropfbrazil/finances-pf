
-- 1. Rename codigo_alternativo → codigo_reduzido
ALTER TABLE stock_products RENAME COLUMN codigo_alternativo TO codigo_reduzido;

-- 2. Add new codigo_alternativo column
ALTER TABLE stock_products ADD COLUMN IF NOT EXISTS codigo_alternativo text;

-- 3. Drop old index and create explicit one for codigo_reduzido
DROP INDEX IF EXISTS stock_products_codigo_alternativo_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_products_codigo_reduzido
  ON stock_products (codigo_reduzido) WHERE codigo_reduzido IS NOT NULL;

-- 4. Create unique partial index on new codigo_alternativo
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_products_codigo_alternativo
  ON stock_products (codigo_alternativo) WHERE codigo_alternativo IS NOT NULL;
