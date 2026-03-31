
-- Create receivables table
CREATE TABLE public.receivables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  document_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD', 'EUR')),
  original_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1,
  amount_brl NUMERIC(18,2) GENERATED ALWAYS AS (original_amount * exchange_rate) STORED,
  market TEXT NOT NULL DEFAULT 'interno' CHECK (market IN ('interno', 'externo')),
  status TEXT NOT NULL DEFAULT 'em_aberto' CHECK (status IN ('em_aberto', 'vencido', 'recebido', 'parcial')),
  receipt_date DATE,
  receipt_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(18,2) GENERATED ALWAYS AS ((original_amount * exchange_rate) - receipt_amount) STORED,
  notes TEXT,
  responsible_user UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view receivables"
  ON public.receivables FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert receivables"
  ON public.receivables FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update receivables"
  ON public.receivables FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete receivables"
  ON public.receivables FOR DELETE USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_receivables_updated_at
  BEFORE UPDATE ON public.receivables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Split the existing receivables reconciliation_summary row into two: interno and externo
-- First update existing row to be 'receivables_interno'
UPDATE public.reconciliation_summary
  SET module_name = 'receivables_interno',
      accounting_account = '1.1.02.001',
      accounting_balance = 317800.00
  WHERE module_name = 'receivables';

-- Insert externo row
INSERT INTO public.reconciliation_summary (period_id, module_name, accounting_account, management_balance, accounting_balance, status)
  SELECT period_id, 'receivables_externo', '1.1.02.008', 0, 449813.28, 'divergent'
  FROM public.reconciliation_summary
  WHERE module_name = 'receivables_interno'
  LIMIT 1;

-- Function to auto-update reconciliation_summary when receivables change
CREATE OR REPLACE FUNCTION public.update_receivables_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id UUID;
  v_total_interno NUMERIC(18,2);
  v_total_externo NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  -- Sum remaining balances for open/overdue/partial titles per market
  SELECT COALESCE(SUM((original_amount * exchange_rate) - receipt_amount), 0)
  INTO v_total_interno
  FROM public.receivables
  WHERE period_id = v_period_id AND market = 'interno' AND status != 'recebido';

  SELECT COALESCE(SUM((original_amount * exchange_rate) - receipt_amount), 0)
  INTO v_total_externo
  FROM public.receivables
  WHERE period_id = v_period_id AND market = 'externo' AND status != 'recebido';

  UPDATE public.reconciliation_summary
  SET management_balance = v_total_interno,
      status = CASE WHEN v_total_interno = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'receivables_interno';

  UPDATE public.reconciliation_summary
  SET management_balance = v_total_externo,
      status = CASE WHEN v_total_externo = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'receivables_externo';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_receivables_reconciliation
  AFTER INSERT OR UPDATE OR DELETE ON public.receivables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_receivables_reconciliation();
