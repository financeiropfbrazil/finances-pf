
-- Create payables table
CREATE TABLE public.payables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  supplier_name TEXT NOT NULL,
  document_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  original_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1,
  amount_brl NUMERIC(18,2) GENERATED ALWAYS AS (original_amount * exchange_rate) STORED,
  category TEXT NOT NULL DEFAULT 'outros',
  status TEXT NOT NULL DEFAULT 'em_aberto',
  payment_date DATE,
  payment_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(18,2) GENERATED ALWAYS AS ((original_amount * exchange_rate) - payment_amount) STORED,
  notes TEXT,
  responsible_user UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view payables" ON public.payables FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert payables" ON public.payables FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update payables" ON public.payables FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete payables" ON public.payables FOR DELETE USING (auth.uid() IS NOT NULL);

-- Updated_at trigger
CREATE TRIGGER update_payables_updated_at BEFORE UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reconciliation sync trigger
CREATE OR REPLACE FUNCTION public.update_payables_reconciliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period_id UUID;
  v_total NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  SELECT COALESCE(SUM((original_amount * exchange_rate) - payment_amount), 0)
  INTO v_total
  FROM public.payables
  WHERE period_id = v_period_id AND status != 'pago';

  UPDATE public.reconciliation_summary
  SET management_balance = v_total,
      status = CASE WHEN v_total = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'suppliers';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_payables_reconciliation
  AFTER INSERT OR UPDATE OR DELETE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.update_payables_reconciliation();

-- Seed reconciliation_summary for suppliers in Jan/2026
INSERT INTO public.reconciliation_summary (period_id, module_name, accounting_account, accounting_balance, management_balance, status)
SELECT p.id, 'suppliers', '2.1.03', 1010707.29, 0, 'divergent'
FROM public.periods p WHERE p.year = 2026 AND p.month = 1
ON CONFLICT DO NOTHING;
