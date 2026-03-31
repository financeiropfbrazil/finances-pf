
-- Add new columns to intercompany table
ALTER TABLE public.intercompany
  ADD COLUMN source text NOT NULL DEFAULT 'manual',
  ADD COLUMN alvo_document_id text,
  ADD COLUMN doc_type text,
  ADD COLUMN nf_number text,
  ADD COLUMN nf_series text,
  ADD COLUMN nf_model text,
  ADD COLUMN cfop text,
  ADD COLUMN issue_date date,
  ADD COLUMN competence_date date,
  ADD COLUMN alvo_entity_code text,
  ADD COLUMN alvo_country_code text,
  ADD COLUMN invoice_reference text,
  ADD COLUMN service_value numeric,
  ADD COLUMN product_value numeric,
  ADD COLUMN freight_value numeric,
  ADD COLUMN tax_total numeric,
  ADD COLUMN last_synced_at timestamptz;

-- Partial unique index (only for non-null values)
CREATE UNIQUE INDEX idx_intercompany_alvo_document_id_unique ON public.intercompany(alvo_document_id) WHERE alvo_document_id IS NOT NULL;

-- Regular indexes
CREATE INDEX idx_intercompany_source ON public.intercompany(source);
CREATE INDEX idx_intercompany_doc_type ON public.intercompany(doc_type);
CREATE INDEX idx_intercompany_issue_date ON public.intercompany(issue_date);
