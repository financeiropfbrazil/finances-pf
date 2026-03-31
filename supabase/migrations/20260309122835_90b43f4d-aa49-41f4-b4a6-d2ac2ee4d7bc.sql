
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
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);

  SELECT COALESCE(SUM(gross_value), 0), COALESCE(SUM(accumulated_depreciation), 0)
  INTO v_total_gross, v_total_dep
  FROM public.fixed_assets_items
  WHERE period_id = v_period_id AND status = 'ativo';

  UPDATE public.fixed_assets_summary
  SET gross_asset_value = v_total_gross,
      accumulated_depreciation = v_total_dep,
      status = CASE WHEN (v_total_gross - v_total_dep) = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id;

  -- Also update reconciliation_summary
  UPDATE public.reconciliation_summary
  SET management_balance = v_total_gross - v_total_dep,
      status = CASE WHEN (v_total_gross - v_total_dep) = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'fixed_assets';

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Also fix calculate_monthly_depreciation to not update generated columns
CREATE OR REPLACE FUNCTION public.calculate_monthly_depreciation(p_period_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_cat RECORD;
  v_dep_monthly numeric;
  v_dep_total numeric;
  v_period_end date;
  v_count integer := 0;
  v_period RECORD;
  v_months integer;
BEGIN
  SELECT year, month INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_period_end := (make_date(v_period.year, v_period.month, 1) + interval '1 month' - interval '1 day')::date;

  FOR v_item IN
    SELECT fi.*
    FROM public.fixed_assets_items fi
    WHERE fi.period_id = p_period_id AND fi.status = 'ativo'
  LOOP
    v_cat := NULL;
    IF v_item.category_id IS NOT NULL THEN
      SELECT * INTO v_cat FROM public.fixed_assets_categories WHERE id = v_item.category_id;
    END IF;
    IF v_cat IS NULL THEN
      SELECT * INTO v_cat FROM public.fixed_assets_categories WHERE code = v_item.category;
    END IF;

    IF v_cat IS NOT NULL AND v_cat.depreciable = false THEN
      UPDATE public.fixed_assets_items
        SET accumulated_depreciation = 0
        WHERE id = v_item.id AND accumulated_depreciation != 0;
      CONTINUE;
    END IF;

    IF v_item.acquisition_date IS NULL THEN
      CONTINUE;
    END IF;

    v_dep_monthly := 0;
    IF COALESCE(v_item.monthly_depreciation_rate, 0) > 0 THEN
      v_dep_monthly := v_item.gross_value * (v_item.monthly_depreciation_rate / 100.0);
    ELSIF COALESCE(v_item.useful_life_months, 0) > 0 THEN
      v_dep_monthly := v_item.gross_value / v_item.useful_life_months;
    ELSIF v_cat IS NOT NULL AND COALESCE(v_cat.default_monthly_rate, 0) > 0 THEN
      v_dep_monthly := v_item.gross_value * (v_cat.default_monthly_rate / 100.0);
    ELSE
      CONTINUE;
    END IF;

    v_months := (EXTRACT(YEAR FROM v_period_end) * 12 + EXTRACT(MONTH FROM v_period_end))
              - (EXTRACT(YEAR FROM v_item.acquisition_date) * 12 + EXTRACT(MONTH FROM v_item.acquisition_date));
    IF v_months < 0 THEN v_months := 0; END IF;

    v_dep_total := LEAST(v_dep_monthly * v_months, v_item.gross_value);
    v_dep_total := ROUND(v_dep_total, 2);

    UPDATE public.fixed_assets_items
      SET accumulated_depreciation = v_dep_total
      WHERE id = v_item.id;

    v_count := v_count + 1;
  END LOOP;

  -- Update fixed_assets_summary (without touching generated net_asset_value)
  UPDATE public.fixed_assets_summary
  SET gross_asset_value = sub.total_gross,
      accumulated_depreciation = sub.total_dep,
      updated_at = now()
  FROM (
    SELECT COALESCE(SUM(gross_value), 0) AS total_gross,
           COALESCE(SUM(accumulated_depreciation), 0) AS total_dep
    FROM public.fixed_assets_items
    WHERE period_id = p_period_id AND status = 'ativo'
  ) sub
  WHERE fixed_assets_summary.period_id = p_period_id;

  -- Update fixed_assets_reconciliation per category
  INSERT INTO public.fixed_assets_reconciliation (period_id, category_id, account_asset, account_depreciation, gross_value, accumulated_depreciation)
  SELECT
    p_period_id,
    cat.id,
    cat.account_asset,
    cat.account_depreciation,
    COALESCE(SUM(fi.gross_value), 0),
    COALESCE(SUM(fi.accumulated_depreciation), 0)
  FROM public.fixed_assets_categories cat
  LEFT JOIN public.fixed_assets_items fi
    ON fi.category_id = cat.id AND fi.period_id = p_period_id AND fi.status = 'ativo'
  GROUP BY cat.id, cat.account_asset, cat.account_depreciation
  ON CONFLICT (period_id, category_id)
  DO UPDATE SET
    gross_value = EXCLUDED.gross_value,
    accumulated_depreciation = EXCLUDED.accumulated_depreciation,
    difference = (EXCLUDED.gross_value - EXCLUDED.accumulated_depreciation) - (COALESCE(fixed_assets_reconciliation.accounting_balance_asset, 0) - COALESCE(fixed_assets_reconciliation.accounting_balance_depreciation, 0)),
    status = CASE
      WHEN (EXCLUDED.gross_value - EXCLUDED.accumulated_depreciation) = (COALESCE(fixed_assets_reconciliation.accounting_balance_asset, 0) - COALESCE(fixed_assets_reconciliation.accounting_balance_depreciation, 0)) THEN 'reconciled'
      WHEN fixed_assets_reconciliation.justification IS NOT NULL AND fixed_assets_reconciliation.justification != '' THEN 'justified'
      ELSE 'divergent'
    END,
    updated_at = now();

  RETURN v_count;
END;
$function$;

-- Also fix the reconciliation trigger
CREATE OR REPLACE FUNCTION public.update_fixed_assets_reconciliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_id UUID;
  v_net NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);
  v_net := COALESCE(NEW.gross_asset_value, 0) - COALESCE(NEW.accumulated_depreciation, 0);

  UPDATE public.reconciliation_summary
  SET management_balance = v_net,
      status = CASE WHEN v_net = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'fixed_assets';

  RETURN COALESCE(NEW, OLD);
END;
$function$;
