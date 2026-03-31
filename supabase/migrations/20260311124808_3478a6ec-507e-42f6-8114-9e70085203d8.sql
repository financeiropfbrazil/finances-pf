
-- Adicionar campo status
ALTER TABLE stock_balance
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

-- Adicionar constraint check separadamente (não usar CHECK inline com ADD COLUMN IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_balance_status_check'
  ) THEN
    ALTER TABLE stock_balance
      ADD CONSTRAINT stock_balance_status_check CHECK (status IN ('draft', 'closed'));
  END IF;
END $$;

-- Auditoria de fechamento
ALTER TABLE stock_balance
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS closed_by text NULL;

-- Índice para busca por período + status
CREATE INDEX IF NOT EXISTS idx_stock_balance_periodo_status
  ON stock_balance (periodo, status);

-- Índice para busca por data_referencia + status
CREATE INDEX IF NOT EXISTS idx_stock_balance_data_ref_status
  ON stock_balance (data_referencia, status);
