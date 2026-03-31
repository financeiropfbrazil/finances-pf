
-- Add ERP columns to cost_centers
ALTER TABLE public.cost_centers
  ADD COLUMN IF NOT EXISTS erp_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS erp_short_code text,
  ADD COLUMN IF NOT EXISTS parent_code text,
  ADD COLUMN IF NOT EXISTS group_type text,
  ADD COLUMN IF NOT EXISTS cost_type text,
  ADD COLUMN IF NOT EXISTS department_type text,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
