
-- Create docfin_mapping table
CREATE TABLE public.docfin_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercompany_id uuid NOT NULL REFERENCES public.intercompany(id) ON DELETE CASCADE,
  alvo_document_id text NOT NULL,
  docfin_key integer NOT NULL,
  docfin_number text,
  docfin_type text,
  docfin_situation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX idx_docfin_mapping_ic_key ON public.docfin_mapping (intercompany_id, docfin_key);
CREATE INDEX idx_docfin_mapping_alvo_doc ON public.docfin_mapping (alvo_document_id);
CREATE INDEX idx_docfin_mapping_docfin_key ON public.docfin_mapping (docfin_key);

-- RLS
ALTER TABLE public.docfin_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select docfin_mapping" ON public.docfin_mapping FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert docfin_mapping" ON public.docfin_mapping FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update docfin_mapping" ON public.docfin_mapping FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete docfin_mapping" ON public.docfin_mapping FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_docfin_mapping_updated_at
  BEFORE UPDATE ON public.docfin_mapping
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
