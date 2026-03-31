
-- Create nf_entrada table
CREATE TABLE public.nf_entrada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_chave integer NOT NULL UNIQUE,
  tipo_lancamento text NOT NULL,
  especie text,
  numero text,
  serie text,
  data_emissao date,
  data_movimento date,
  data_entrada timestamptz,
  fornecedor_codigo text,
  fornecedor_nome text,
  fornecedor_cnpj text,
  valor_documento numeric(15,2),
  valor_liquido numeric(15,2),
  valor_mercadoria numeric(15,2),
  chave_acesso_nfe text,
  observacao text,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  raw_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_nf_entrada_data_movimento ON public.nf_entrada(data_movimento);
CREATE INDEX idx_nf_entrada_fornecedor ON public.nf_entrada(fornecedor_codigo);

-- Enable RLS
ALTER TABLE public.nf_entrada ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users
CREATE POLICY "Auth users can select nf_entrada"
  ON public.nf_entrada FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert nf_entrada"
  ON public.nf_entrada FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update nf_entrada"
  ON public.nf_entrada FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete nf_entrada"
  ON public.nf_entrada FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_nf_entrada_updated_at
  BEFORE UPDATE ON public.nf_entrada
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
