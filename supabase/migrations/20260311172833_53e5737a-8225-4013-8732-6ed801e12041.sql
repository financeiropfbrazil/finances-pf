
-- 1. Update CHECK constraint on stock_counts.tipo_chave to include 'codigo_reduzido'
ALTER TABLE public.stock_counts DROP CONSTRAINT IF EXISTS stock_counts_tipo_chave_check;
ALTER TABLE public.stock_counts ADD CONSTRAINT stock_counts_tipo_chave_check 
  CHECK (tipo_chave IN ('codigo_produto', 'codigo_reduzido', 'codigo_alternativo'));

-- 2. Add valor_total_contagem column to stock_count_items
ALTER TABLE public.stock_count_items ADD COLUMN IF NOT EXISTS valor_total_contagem numeric;
