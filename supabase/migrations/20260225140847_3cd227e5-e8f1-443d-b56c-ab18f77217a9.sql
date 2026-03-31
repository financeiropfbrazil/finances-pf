
-- Create bank_accounts table
CREATE TABLE public.bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'corrente' CHECK (account_type IN ('corrente', 'aplicacao', 'poupanca')),
  account_number TEXT,
  accounting_account_code TEXT NOT NULL,
  bank_statement_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  accounting_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference NUMERIC(18,2) GENERATED ALWAYS AS (bank_statement_balance - accounting_balance) STORED,
  status TEXT NOT NULL DEFAULT 'divergent' CHECK (status IN ('reconciled', 'justified', 'divergent')),
  justification TEXT,
  responsible_user UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view bank_accounts"
  ON public.bank_accounts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert bank_accounts"
  ON public.bank_accounts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update bank_accounts"
  ON public.bank_accounts FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete bank_accounts"
  ON public.bank_accounts FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-update reconciliation_summary when bank_accounts change
CREATE OR REPLACE FUNCTION public.update_cash_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id UUID;
  v_total_statement NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);
  
  SELECT COALESCE(SUM(bank_statement_balance), 0)
  INTO v_total_statement
  FROM public.bank_accounts
  WHERE period_id = v_period_id;

  UPDATE public.reconciliation_summary
  SET management_balance = v_total_statement,
      status = CASE
        WHEN v_total_statement = accounting_balance THEN 'reconciled'
        ELSE 'divergent'
      END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'cash';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_cash_reconciliation
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_cash_reconciliation();
