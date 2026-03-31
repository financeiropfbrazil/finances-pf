
-- Tabela sales_invoices
CREATE TABLE public.sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_nf text NOT NULL,
  serie text,
  chave_acesso text UNIQUE,
  data_emissao date NOT NULL,
  data_transmissao date,
  periodo text NOT NULL,
  codigo_entidade text,
  razao_social text,
  cnpj_destinatario text,
  valor_brl numeric,
  status text,
  codigo_usuario text,
  numero_protocolo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select sales_invoices" ON public.sales_invoices FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert sales_invoices" ON public.sales_invoices FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update sales_invoices" ON public.sales_invoices FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete sales_invoices" ON public.sales_invoices FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Tabela sales_excluded_cnpj
CREATE TABLE public.sales_excluded_cnpj (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text UNIQUE NOT NULL,
  razao_social text,
  motivo text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sales_excluded_cnpj ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select sales_excluded_cnpj" ON public.sales_excluded_cnpj FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert sales_excluded_cnpj" ON public.sales_excluded_cnpj FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update sales_excluded_cnpj" ON public.sales_excluded_cnpj FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete sales_excluded_cnpj" ON public.sales_excluded_cnpj FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
