
-- Create table intercompany_alvo_docs
CREATE TABLE public.intercompany_alvo_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alvo_document_id text NOT NULL UNIQUE,
  doc_type text NOT NULL,
  nf_model text,
  nf_series text,
  nf_number text,
  docfin_key integer,
  entity_code text NOT NULL,
  entity_name text,
  country_code text,
  issue_date date,
  competence_date date,
  currency text NOT NULL DEFAULT 'BRL',
  original_amount numeric NOT NULL DEFAULT 0,
  exchange_rate numeric NOT NULL DEFAULT 1,
  amount_brl numeric,
  cfop text,
  service_value numeric,
  product_value numeric,
  freight_value numeric,
  tax_iss numeric,
  tax_pis numeric,
  tax_cofins numeric,
  tax_csll numeric,
  invoice_reference text,
  document_origin text,
  dados_adicionais text,
  is_cancelled boolean NOT NULL DEFAULT false,
  raw_json jsonb,
  sync_status text NOT NULL DEFAULT 'synced',
  sync_error text,
  intercompany_id uuid REFERENCES public.intercompany(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_intercompany_alvo_docs_entity_code ON public.intercompany_alvo_docs(entity_code);
CREATE INDEX idx_intercompany_alvo_docs_competence_date ON public.intercompany_alvo_docs(competence_date);
CREATE INDEX idx_intercompany_alvo_docs_doc_type ON public.intercompany_alvo_docs(doc_type);
CREATE INDEX idx_intercompany_alvo_docs_sync_status ON public.intercompany_alvo_docs(sync_status);

-- RLS
ALTER TABLE public.intercompany_alvo_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view intercompany_alvo_docs" ON public.intercompany_alvo_docs FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert intercompany_alvo_docs" ON public.intercompany_alvo_docs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update intercompany_alvo_docs" ON public.intercompany_alvo_docs FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete intercompany_alvo_docs" ON public.intercompany_alvo_docs FOR DELETE USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_intercompany_alvo_docs_updated_at
  BEFORE UPDATE ON public.intercompany_alvo_docs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
