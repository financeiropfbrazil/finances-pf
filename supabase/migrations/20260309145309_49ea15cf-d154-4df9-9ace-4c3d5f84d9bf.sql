
-- 1. Tabela balancete_uploads
CREATE TABLE public.balancete_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.periods(id),
  file_name text NOT NULL,
  uploaded_by text,
  total_accounts integer DEFAULT 0,
  total_analytical integer DEFAULT 0,
  status text DEFAULT 'processing',
  error_message text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT balancete_uploads_period_unique UNIQUE (period_id)
);

ALTER TABLE public.balancete_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select balancete_uploads" ON public.balancete_uploads FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert balancete_uploads" ON public.balancete_uploads FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update balancete_uploads" ON public.balancete_uploads FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete balancete_uploads" ON public.balancete_uploads FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 2. Tabela balancete_accounts
CREATE TABLE public.balancete_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.balancete_uploads(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.periods(id),
  account_number integer,
  account_type text NOT NULL,
  account_code text NOT NULL,
  description text NOT NULL,
  previous_balance numeric DEFAULT 0,
  debit numeric DEFAULT 0,
  credit numeric DEFAULT 0,
  current_balance numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT balancete_accounts_upload_code_unique UNIQUE (upload_id, account_code)
);

CREATE INDEX idx_balancete_accounts_period ON public.balancete_accounts(period_id);
CREATE INDEX idx_balancete_accounts_code ON public.balancete_accounts(account_code);

ALTER TABLE public.balancete_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select balancete_accounts" ON public.balancete_accounts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert balancete_accounts" ON public.balancete_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update balancete_accounts" ON public.balancete_accounts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete balancete_accounts" ON public.balancete_accounts FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 3. Tabela balancete_module_mapping
CREATE TABLE public.balancete_module_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name text NOT NULL,
  account_code_pattern text NOT NULL,
  target_field text NOT NULL,
  target_table text NOT NULL,
  match_type text DEFAULT 'exact',
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_balancete_mapping_module ON public.balancete_module_mapping(module_name);

ALTER TABLE public.balancete_module_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select balancete_module_mapping" ON public.balancete_module_mapping FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert balancete_module_mapping" ON public.balancete_module_mapping FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update balancete_module_mapping" ON public.balancete_module_mapping FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete balancete_module_mapping" ON public.balancete_module_mapping FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
