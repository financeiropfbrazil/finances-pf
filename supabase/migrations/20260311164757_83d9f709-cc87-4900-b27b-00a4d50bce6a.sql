
-- =============================================
-- Tabela: stock_counts
-- =============================================
CREATE TABLE public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao text NOT NULL,
  data_referencia date NOT NULL,
  tipo_chave text NOT NULL CHECK (tipo_chave IN ('codigo_produto', 'codigo_alternativo')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'parcial', 'concluida')),
  total_itens integer NOT NULL DEFAULT 0,
  itens_divergentes integer NOT NULL DEFAULT 0,
  itens_aprovados integer NOT NULL DEFAULT 0,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_counts_data_referencia ON public.stock_counts (data_referencia);
CREATE INDEX idx_stock_counts_status ON public.stock_counts (status);

-- =============================================
-- Tabela: stock_count_items
-- =============================================
CREATE TABLE public.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.stock_products(id) ON DELETE CASCADE,
  codigo_enviado text NOT NULL,
  quantidade_sistema numeric NOT NULL,
  quantidade_contagem numeric NOT NULL,
  diferenca numeric NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  aprovado_por text,
  aprovado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_count_items_count_id ON public.stock_count_items (count_id);
CREATE INDEX idx_stock_count_items_product_id ON public.stock_count_items (product_id);
CREATE INDEX idx_stock_count_items_status ON public.stock_count_items (status);
CREATE UNIQUE INDEX idx_stock_count_items_unique ON public.stock_count_items (count_id, product_id);

-- =============================================
-- Tabela: stock_adjustments
-- =============================================
CREATE TABLE public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_item_id uuid NOT NULL REFERENCES public.stock_count_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.stock_products(id) ON DELETE CASCADE,
  data_referencia date NOT NULL,
  quantidade_anterior numeric NOT NULL,
  quantidade_nova numeric NOT NULL,
  valor_total_anterior numeric,
  valor_total_novo numeric,
  motivo text NOT NULL DEFAULT 'Contagem física',
  ajustado_por text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_adjustments_product_id ON public.stock_adjustments (product_id);
CREATE INDEX idx_stock_adjustments_data_referencia ON public.stock_adjustments (data_referencia);
CREATE INDEX idx_stock_adjustments_count_item_id ON public.stock_adjustments (count_item_id);

-- =============================================
-- RLS
-- =============================================
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

-- stock_counts policies
CREATE POLICY "Auth users can select stock_counts" ON public.stock_counts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert stock_counts" ON public.stock_counts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update stock_counts" ON public.stock_counts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete stock_counts" ON public.stock_counts FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- stock_count_items policies
CREATE POLICY "Auth users can select stock_count_items" ON public.stock_count_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert stock_count_items" ON public.stock_count_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update stock_count_items" ON public.stock_count_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete stock_count_items" ON public.stock_count_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- stock_adjustments policies
CREATE POLICY "Auth users can select stock_adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert stock_adjustments" ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update stock_adjustments" ON public.stock_adjustments FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete stock_adjustments" ON public.stock_adjustments FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- =============================================
-- Trigger updated_at em stock_counts
-- =============================================
CREATE TRIGGER set_stock_counts_updated_at
  BEFORE UPDATE ON public.stock_counts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
