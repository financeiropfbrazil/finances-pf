
-- Create commodatum contracts table
CREATE TABLE public.commodatum_contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  contract_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  value NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo',
  object_description TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  file_name TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.commodatum_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view commodatum_contracts" ON public.commodatum_contracts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert commodatum_contracts" ON public.commodatum_contracts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update commodatum_contracts" ON public.commodatum_contracts FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete commodatum_contracts" ON public.commodatum_contracts FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_commodatum_contracts_updated_at
  BEFORE UPDATE ON public.commodatum_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for contract files
INSERT INTO storage.buckets (id, name, public) VALUES ('contracts', 'contracts', false);

CREATE POLICY "Auth users can upload contracts" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'contracts' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can view contracts" ON storage.objects FOR SELECT USING (bucket_id = 'contracts' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete contracts" ON storage.objects FOR DELETE USING (bucket_id = 'contracts' AND auth.uid() IS NOT NULL);
