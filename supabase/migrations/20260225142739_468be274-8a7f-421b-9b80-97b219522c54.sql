
-- Table for fixed assets summary
CREATE TABLE public.fixed_assets_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  gross_asset_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_asset_value NUMERIC(18,2) GENERATED ALWAYS AS (gross_asset_value - accumulated_depreciation) STORED,
  accounting_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference NUMERIC(18,2) GENERATED ALWAYS AS ((gross_asset_value - accumulated_depreciation) - accounting_balance) STORED,
  status TEXT NOT NULL DEFAULT 'divergent',
  justification TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  api_last_sync TIMESTAMPTZ,
  api_status TEXT NOT NULL DEFAULT 'not_configured',
  responsible_user UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(period_id)
);

ALTER TABLE public.fixed_assets_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view fixed_assets_summary" ON public.fixed_assets_summary FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert fixed_assets_summary" ON public.fixed_assets_summary FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update fixed_assets_summary" ON public.fixed_assets_summary FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete fixed_assets_summary" ON public.fixed_assets_summary FOR DELETE USING (auth.uid() IS NOT NULL);

-- Trigger to sync reconciliation_summary
CREATE OR REPLACE FUNCTION public.update_fixed_assets_reconciliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period_id UUID;
  v_net NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);
  v_net := COALESCE(NEW.net_asset_value, 0);

  UPDATE public.reconciliation_summary
  SET management_balance = v_net,
      status = CASE WHEN v_net = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'fixed_assets';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_fixed_assets_reconciliation
AFTER INSERT OR UPDATE OR DELETE ON public.fixed_assets_summary
FOR EACH ROW EXECUTE FUNCTION public.update_fixed_assets_reconciliation();

-- Updated_at trigger
CREATE TRIGGER update_fixed_assets_summary_updated_at
BEFORE UPDATE ON public.fixed_assets_summary
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial record for Jan/2026
INSERT INTO public.fixed_assets_summary (period_id, accounting_balance)
SELECT id, 5692315.81 FROM public.periods WHERE month = 1 AND year = 2026 LIMIT 1;
