-- Fix stock capture conflicts: keep daily uniqueness and remove monthly uniqueness
ALTER TABLE public.stock_balance
DROP CONSTRAINT IF EXISTS stock_balance_product_periodo_key;