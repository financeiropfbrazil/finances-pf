
-- Drop the cascading trigger on fixed_assets_summary that causes timeout
DROP TRIGGER IF EXISTS sync_fixed_assets_reconciliation ON fixed_assets_summary;

-- Merge the reconciliation_summary update into the items trigger directly
CREATE OR REPLACE FUNCTION public.update_fixed_assets_from_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_id UUID;
  v_total_gross NUMERIC(18,2);
  v_total_dep NUMERIC(18,2);
  v_total_net NUMERIC(18,2);
  v_summary_exists BOOLEAN;
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  SELECT COALESCE(SUM(gross_value), 0), COALESCE(SUM(accumulated_depreciation), 0)
  INTO v_total_gross, v_total_dep
  FROM public.fixed_assets_items
  WHERE period_id = v_period_id AND status = 'ativo';

  v_total_net := v_total_gross - v_total_dep;

  -- Update summary without touching generated net_asset_value column
  SELECT EXISTS(SELECT 1 FROM public.fixed_assets_summary WHERE period_id = v_period_id) INTO v_summary_exists;
  
  IF v_summary_exists THEN
    UPDATE public.fixed_assets_summary
    SET gross_asset_value = v_total_gross,
        accumulated_depreciation = v_total_dep,
        status = CASE WHEN v_total_net = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
        updated_at = now()
    WHERE period_id = v_period_id;
  END IF;

  -- Directly update reconciliation_summary (no cascading trigger needed)
  UPDATE public.reconciliation_summary
  SET management_balance = v_total_net,
      status = CASE WHEN v_total_net = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'fixed_assets';

  RETURN COALESCE(NEW, OLD);
END;
$function$;
