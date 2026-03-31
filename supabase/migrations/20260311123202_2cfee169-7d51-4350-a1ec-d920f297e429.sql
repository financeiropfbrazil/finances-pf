
-- 1. Remover o UNIQUE constraint antigo (product_id, periodo)
ALTER TABLE stock_balance
  DROP CONSTRAINT IF EXISTS stock_balance_product_id_periodo_key;

-- Caso o constraint tenha sido criado como índice único:
DROP INDEX IF EXISTS stock_balance_product_id_periodo_key;
DROP INDEX IF EXISTS stock_balance_product_id_periodo_idx;

-- 2. Criar novo UNIQUE constraint (product_id, data_referencia)
ALTER TABLE stock_balance
  ADD CONSTRAINT stock_balance_product_id_data_referencia_key
  UNIQUE (product_id, data_referencia);

-- 3. Índice para busca por data_referencia
CREATE INDEX IF NOT EXISTS idx_stock_balance_data_referencia
  ON stock_balance (data_referencia);

-- 4. Manter índice em periodo para consultas de fechamento
CREATE INDEX IF NOT EXISTS idx_stock_balance_periodo
  ON stock_balance (periodo);
