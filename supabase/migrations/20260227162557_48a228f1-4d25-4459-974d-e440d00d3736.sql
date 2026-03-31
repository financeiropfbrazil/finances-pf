
-- Table for OFX bank statement transactions
CREATE TABLE public.bank_statement_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  fit_id TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  matched_erp_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(period_id, fit_id)
);

ALTER TABLE public.bank_statement_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view bank_statement_transactions" ON public.bank_statement_transactions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert bank_statement_transactions" ON public.bank_statement_transactions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update bank_statement_transactions" ON public.bank_statement_transactions FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete bank_statement_transactions" ON public.bank_statement_transactions FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_bank_statement_transactions_updated_at
  BEFORE UPDATE ON public.bank_statement_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table for ERP synced transactions
CREATE TABLE public.erp_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  erp_id TEXT NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  description TEXT,
  entity_name TEXT,
  transaction_type TEXT NOT NULL DEFAULT 'REC',
  realized TEXT NOT NULL DEFAULT 'Não',
  matched_ofx_fit_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(period_id, erp_id)
);

ALTER TABLE public.erp_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view erp_transactions" ON public.erp_transactions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert erp_transactions" ON public.erp_transactions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update erp_transactions" ON public.erp_transactions FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete erp_transactions" ON public.erp_transactions FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_erp_transactions_updated_at
  BEFORE UPDATE ON public.erp_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
