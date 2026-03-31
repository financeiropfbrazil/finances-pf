
-- Table: tax_installments_plan
CREATE TABLE public.tax_installments_plan (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  tax_type TEXT NOT NULL DEFAULT 'outros',
  program_name TEXT NOT NULL DEFAULT '',
  process_number TEXT,
  original_debt NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_consolidated NUMERIC(18,2) GENERATED ALWAYS AS (original_debt + penalty_amount + interest_amount) STORED,
  total_installments INTEGER NOT NULL DEFAULT 1,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  current_installment_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  outstanding_balance_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  outstanding_balance_short_term NUMERIC(18,2) NOT NULL DEFAULT 0,
  outstanding_balance_long_term NUMERIC(18,2) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  next_due_date DATE,
  update_index TEXT NOT NULL DEFAULT 'SELIC',
  status TEXT NOT NULL DEFAULT 'ativo',
  notes TEXT,
  responsible_user UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_installments_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view tax_installments_plan" ON public.tax_installments_plan FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert tax_installments_plan" ON public.tax_installments_plan FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update tax_installments_plan" ON public.tax_installments_plan FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete tax_installments_plan" ON public.tax_installments_plan FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_tax_installments_plan_updated_at
  BEFORE UPDATE ON public.tax_installments_plan
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: tax_installment_payments
CREATE TABLE public.tax_installment_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.tax_installments_plan(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL DEFAULT 1,
  due_date DATE NOT NULL,
  principal_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) GENERATED ALWAYS AS (principal_amount + interest_amount + penalty_amount) STORED,
  status TEXT NOT NULL DEFAULT 'a_vencer',
  payment_date DATE,
  amount_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
  darf_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_installment_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view tax_installment_payments" ON public.tax_installment_payments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert tax_installment_payments" ON public.tax_installment_payments FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update tax_installment_payments" ON public.tax_installment_payments FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete tax_installment_payments" ON public.tax_installment_payments FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_tax_installment_payments_updated_at
  BEFORE UPDATE ON public.tax_installment_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reconciliation trigger for taxes
CREATE OR REPLACE FUNCTION public.update_taxes_reconciliation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period_id UUID;
  v_total_cp NUMERIC(18,2);
  v_total_lp NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  SELECT COALESCE(SUM(outstanding_balance_short_term), 0),
         COALESCE(SUM(outstanding_balance_long_term), 0)
  INTO v_total_cp, v_total_lp
  FROM public.tax_installments_plan
  WHERE period_id = v_period_id AND status != 'quitado' AND status != 'cancelado';

  UPDATE public.reconciliation_summary
  SET management_balance = v_total_cp,
      status = CASE WHEN v_total_cp = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'taxes_cp';

  UPDATE public.reconciliation_summary
  SET management_balance = v_total_lp,
      status = CASE WHEN v_total_lp = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'taxes_lp';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_tax_installments_recon
  AFTER INSERT OR UPDATE OR DELETE ON public.tax_installments_plan
  FOR EACH ROW EXECUTE FUNCTION public.update_taxes_reconciliation();
