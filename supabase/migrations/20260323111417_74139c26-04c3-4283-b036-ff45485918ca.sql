CREATE TABLE IF NOT EXISTS public.compras_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  valor TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.compras_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
  ON public.compras_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

INSERT INTO public.compras_config (chave, valor) VALUES ('nfse_ult_nsu', '0') ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.compras_config (chave, valor) VALUES ('nfe_ult_nsu', '000000000000000') ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.compras_config (chave, valor) VALUES ('nfse_last_query_ts', '') ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.compras_config (chave, valor) VALUES ('nfe_last_query_ts', '') ON CONFLICT (chave) DO NOTHING;