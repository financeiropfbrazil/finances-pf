
-- Table for individual fixed asset items (detail level)
CREATE TABLE public.fixed_assets_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id),
  asset_code TEXT NOT NULL,
  asset_description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'maquinas_equipamentos',
  location TEXT NOT NULL DEFAULT '',
  acquisition_date DATE,
  gross_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_value NUMERIC(18,2) GENERATED ALWAYS AS (gross_value - accumulated_depreciation) STORED,
  monthly_depreciation_rate NUMERIC(8,4) DEFAULT 0,
  useful_life_months INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo',
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  responsible_user UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.fixed_assets_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view fixed_assets_items" ON public.fixed_assets_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert fixed_assets_items" ON public.fixed_assets_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update fixed_assets_items" ON public.fixed_assets_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete fixed_assets_items" ON public.fixed_assets_items FOR DELETE USING (auth.uid() IS NOT NULL);

-- Trigger to update fixed_assets_summary when items change
CREATE OR REPLACE FUNCTION public.update_fixed_assets_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id UUID;
  v_total_gross NUMERIC(18,2);
  v_total_dep NUMERIC(18,2);
  v_total_net NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  SELECT COALESCE(SUM(gross_value), 0), COALESCE(SUM(accumulated_depreciation), 0)
  INTO v_total_gross, v_total_dep
  FROM public.fixed_assets_items
  WHERE period_id = v_period_id AND status = 'ativo';

  v_total_net := v_total_gross - v_total_dep;

  UPDATE public.fixed_assets_summary
  SET gross_asset_value = v_total_gross,
      accumulated_depreciation = v_total_dep,
      net_asset_value = v_total_net,
      status = CASE WHEN v_total_net = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id;

  -- Also update reconciliation_summary
  UPDATE public.reconciliation_summary
  SET management_balance = v_total_net,
      status = CASE WHEN v_total_net = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'fixed_assets';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_fixed_assets_items_reconciliation
AFTER INSERT OR UPDATE OR DELETE ON public.fixed_assets_items
FOR EACH ROW EXECUTE FUNCTION public.update_fixed_assets_from_items();
