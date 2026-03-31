
-- Create intercompany table
CREATE TABLE public.intercompany (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  related_company TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Brasil',
  transaction_type TEXT NOT NULL DEFAULT 'outros',
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'BRL',
  original_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1,
  amount_brl NUMERIC(18,2) GENERATED ALWAYS AS (original_amount * exchange_rate) STORED,
  direction TEXT NOT NULL DEFAULT 'a_pagar',
  document_reference TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'em_aberto',
  notes TEXT,
  responsible_user UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.intercompany ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view intercompany" ON public.intercompany FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert intercompany" ON public.intercompany FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update intercompany" ON public.intercompany FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete intercompany" ON public.intercompany FOR DELETE USING (auth.uid() IS NOT NULL);

-- Updated_at trigger
CREATE TRIGGER update_intercompany_updated_at
  BEFORE UPDATE ON public.intercompany
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reconciliation sync trigger function
CREATE OR REPLACE FUNCTION public.update_intercompany_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id UUID;
  v_net_payable NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  -- Net payable = sum of a_pagar amounts - sum of a_receber amounts (for open items)
  SELECT COALESCE(
    SUM(CASE WHEN direction = 'a_pagar' THEN original_amount * exchange_rate ELSE -(original_amount * exchange_rate) END),
    0
  )
  INTO v_net_payable
  FROM public.intercompany
  WHERE period_id = v_period_id AND status != 'liquidado';

  UPDATE public.reconciliation_summary
  SET management_balance = v_net_payable,
      status = CASE WHEN v_net_payable = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'intercompany';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_intercompany_recon
  AFTER INSERT OR UPDATE OR DELETE ON public.intercompany
  FOR EACH ROW EXECUTE FUNCTION public.update_intercompany_reconciliation();

-- Seed reconciliation_summary for Jan/2026
INSERT INTO public.reconciliation_summary (period_id, module_name, accounting_account, accounting_balance, management_balance, status)
SELECT p.id, 'intercompany', '2.2.01.005', 177325.60, 0, 'divergent'
FROM public.periods p WHERE p.year = 2026 AND p.month = 1
ON CONFLICT DO NOTHING;
