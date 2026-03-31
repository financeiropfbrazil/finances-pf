
-- Table: stock_products
CREATE TABLE public.stock_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_produto text NOT NULL,
  codigo_alternativo text,
  nome_produto text NOT NULL,
  tipo_produto text,
  familia_codigo text,
  variacao text,
  unidade_medida text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_products_codigo_produto_key UNIQUE (codigo_produto)
);

CREATE UNIQUE INDEX stock_products_codigo_alternativo_key ON public.stock_products (codigo_alternativo) WHERE codigo_alternativo IS NOT NULL;
CREATE INDEX stock_products_tipo_produto_idx ON public.stock_products (tipo_produto);
CREATE INDEX stock_products_familia_codigo_idx ON public.stock_products (familia_codigo);
CREATE INDEX stock_products_ativo_idx ON public.stock_products (ativo);

-- Table: stock_balance
CREATE TABLE public.stock_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.stock_products(id) ON DELETE CASCADE,
  periodo text NOT NULL,
  data_referencia date NOT NULL,
  quantidade numeric NOT NULL DEFAULT 0,
  valor_total_brl numeric,
  valor_medio_unitario numeric,
  fonte text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_balance_product_periodo_key UNIQUE (product_id, periodo)
);

CREATE INDEX stock_balance_periodo_idx ON public.stock_balance (periodo);
CREATE INDEX stock_balance_data_referencia_idx ON public.stock_balance (data_referencia);
CREATE INDEX stock_balance_fonte_idx ON public.stock_balance (fonte);

-- RLS: stock_products
ALTER TABLE public.stock_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select stock_products" ON public.stock_products FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert stock_products" ON public.stock_products FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update stock_products" ON public.stock_products FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete stock_products" ON public.stock_products FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- RLS: stock_balance
ALTER TABLE public.stock_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select stock_balance" ON public.stock_balance FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert stock_balance" ON public.stock_balance FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update stock_balance" ON public.stock_balance FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete stock_balance" ON public.stock_balance FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Triggers: updated_at
CREATE TRIGGER update_stock_products_updated_at BEFORE UPDATE ON public.stock_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_stock_balance_updated_at BEFORE UPDATE ON public.stock_balance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
