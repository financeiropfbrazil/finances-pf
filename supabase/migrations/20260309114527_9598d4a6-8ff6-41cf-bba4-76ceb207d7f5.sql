
-- 1. Create fixed_assets_categories table
CREATE TABLE public.fixed_assets_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  account_asset text NOT NULL,
  account_depreciation text,
  default_useful_life_months integer,
  default_monthly_rate numeric,
  depreciable boolean NOT NULL DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.fixed_assets_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view fixed_assets_categories"
  ON public.fixed_assets_categories FOR SELECT
  TO authenticated
  USING (true);

-- 2. Seed initial data
INSERT INTO public.fixed_assets_categories (code, label, account_asset, account_depreciation, default_useful_life_months, default_monthly_rate, depreciable, sort_order) VALUES
('terrenos', 'Terrenos', '1.2.05.001.001', NULL, NULL, NULL, false, 1),
('equip_comunicacao', 'Equipamentos de Comunicação', '1.2.05.003.001', '1.2.05.007.003', 120, 0.8333, true, 2),
('equip_proc_dados', 'Equipamentos para Processamento de Dados', '1.2.05.003.006', '1.2.05.007.008', 60, 1.6667, true, 3),
('instalacoes', 'Instalações', '1.2.05.003.008', '1.2.05.007.010', 120, 0.8333, true, 4),
('maquinas_equipamentos', 'Máquinas, Aparelhos e Equipamentos', '1.2.05.003.008', '1.2.05.007.011', 120, 0.8333, true, 5),
('moveis_utensilios', 'Móveis e Utensílios', '1.2.05.003.013', '1.2.05.007.015', 120, 0.8333, true, 6),
('veiculos', 'Veículos', '1.2.05.003.009', '1.2.05.007.012', 60, 1.6667, true, 7),
('informatica', 'Informática', '1.2.05.003.006', '1.2.05.007.008', 60, 1.6667, true, 8),
('outros', 'Outros', '1.2.05.003.099', '1.2.05.007.099', 120, 0.8333, true, 9);

-- 3. ALTER fixed_assets_items — add new columns
ALTER TABLE public.fixed_assets_items
  ADD COLUMN category_id uuid REFERENCES public.fixed_assets_categories(id),
  ADD COLUMN asset_tag text,
  ADD COLUMN responsible_name text,
  ADD COLUMN responsible_department text,
  ADD COLUMN serial_number text,
  ADD COLUMN brand_model text,
  ADD COLUMN audit_source_id text UNIQUE,
  ADD COLUMN last_audit_date date;

-- 4. Indexes
CREATE INDEX idx_fixed_assets_items_category_id ON public.fixed_assets_items(category_id);
CREATE INDEX idx_fixed_assets_items_audit_source_id ON public.fixed_assets_items(audit_source_id);
