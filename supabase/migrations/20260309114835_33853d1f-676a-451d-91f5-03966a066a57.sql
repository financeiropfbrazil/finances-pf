
CREATE OR REPLACE FUNCTION public.calculate_monthly_depreciation(p_period_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item RECORD;
  v_cat RECORD;
  v_rate numeric;
  v_months integer;
  v_dep_monthly numeric;
  v_dep_total numeric;
  v_period_end date;
  v_count integer := 0;
  v_period RECORD;
BEGIN
  -- Get period end date
  SELECT year, month INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_period_end := (make_date(v_period.year, v_period.month, 1) + interval '1 month' - interval '1 day')::date;

  FOR v_item IN
    SELECT fi.*
    FROM public.fixed_assets_items fi
    WHERE fi.period_id = p_period_id AND fi.status = 'ativo'
  LOOP
    -- Get category info
    v_cat := NULL;
    IF v_item.category_id IS NOT NULL THEN
      SELECT * INTO v_cat FROM public.fixed_assets_categories WHERE id = v_item.category_id;
    END IF;
    IF v_cat IS NULL THEN
      SELECT * INTO v_cat FROM public.fixed_assets_categories WHERE code = v_item.category;
    END IF;

    -- Skip non-depreciable
    IF v_cat IS NOT NULL AND v_cat.depreciable = false THEN
      -- Ensure net_value is correct for non-depreciable
      UPDATE public.fixed_assets_items
        SET accumulated_depreciation = 0, net_value = gross_value
        WHERE id = v_item.id AND (accumulated_depreciation != 0 OR net_value IS DISTINCT FROM gross_value);
      CONTINUE;
    END IF;

    -- Skip if no acquisition date
    IF v_item.acquisition_date IS NULL THEN
      UPDATE public.fixed_assets_items
        SET net_value = gross_value - accumulated_depreciation
        WHERE id = v_item.id;
      CONTINUE;
    END IF;

    -- Determine monthly depreciation rate
    v_rate := 0;
    IF COALESCE(v_item.monthly_depreciation_rate, 0) > 0 THEN
      v_dep_monthly := v_item.gross_value * (v_item.monthly_depreciation_rate / 100.0);
    ELSIF COALESCE(v_item.useful_life_months, 0) > 0 THEN
      v_dep_monthly := v_item.gross_value / v_item.useful_life_months;
    ELSIF v_cat IS NOT NULL AND COALESCE(v_cat.default_monthly_rate, 0) > 0 THEN
      v_dep_monthly := v_item.gross_value * (v_cat.default_monthly_rate / 100.0);
    ELSE
      -- No rate available, skip
      UPDATE public.fixed_assets_items
        SET net_value = gross_value - accumulated_depreciation
        WHERE id = v_item.id;
      CONTINUE;
    END IF;

    -- Calculate months since acquisition
    v_months := (EXTRACT(YEAR FROM v_period_end) * 12 + EXTRACT(MONTH FROM v_period_end))
              - (EXTRACT(YEAR FROM v_item.acquisition_date) * 12 + EXTRACT(MONTH FROM v_item.acquisition_date));
    IF v_months < 0 THEN v_months := 0; END IF;

    -- Total depreciation capped at gross_value
    v_dep_total := LEAST(v_dep_monthly * v_months, v_item.gross_value);
    v_dep_total := ROUND(v_dep_total, 2);

    -- Update item
    UPDATE public.fixed_assets_items
      SET accumulated_depreciation = v_dep_total,
          net_value = gross_value - v_dep_total
      WHERE id = v_item.id;

    v_count := v_count + 1;
  END LOOP;

  -- Update fixed_assets_summary
  UPDATE public.fixed_assets_summary
  SET gross_asset_value = sub.total_gross,
      accumulated_depreciation = sub.total_dep,
      net_asset_value = sub.total_net,
      updated_at = now()
  FROM (
    SELECT COALESCE(SUM(gross_value), 0) AS total_gross,
           COALESCE(SUM(accumulated_depreciation), 0) AS total_dep,
           COALESCE(SUM(COALESCE(net_value, gross_value - accumulated_depreciation)), 0) AS total_net
    FROM public.fixed_assets_items
    WHERE period_id = p_period_id AND status = 'ativo'
  ) sub
  WHERE fixed_assets_summary.period_id = p_period_id;

  -- Update fixed_assets_reconciliation per category
  INSERT INTO public.fixed_assets_reconciliation (period_id, category_id, account_asset, account_depreciation, gross_value, accumulated_depreciation, net_value)
  SELECT
    p_period_id,
    cat.id,
    cat.account_asset,
    cat.account_depreciation,
    COALESCE(SUM(fi.gross_value), 0),
    COALESCE(SUM(fi.accumulated_depreciation), 0),
    COALESCE(SUM(COALESCE(fi.net_value, fi.gross_value - fi.accumulated_depreciation)), 0)
  FROM public.fixed_assets_categories cat
  LEFT JOIN public.fixed_assets_items fi
    ON fi.category_id = cat.id AND fi.period_id = p_period_id AND fi.status = 'ativo'
  GROUP BY cat.id, cat.account_asset, cat.account_depreciation
  ON CONFLICT (period_id, category_id)
  DO UPDATE SET
    gross_value = EXCLUDED.gross_value,
    accumulated_depreciation = EXCLUDED.accumulated_depreciation,
    net_value = EXCLUDED.net_value,
    difference = EXCLUDED.net_value - (fixed_assets_reconciliation.accounting_balance_asset - COALESCE(fixed_assets_reconciliation.accounting_balance_depreciation, 0)),
    status = CASE
      WHEN EXCLUDED.net_value = (fixed_assets_reconciliation.accounting_balance_asset - COALESCE(fixed_assets_reconciliation.accounting_balance_depreciation, 0)) THEN 'reconciled'
      WHEN fixed_assets_reconciliation.justification IS NOT NULL AND fixed_assets_reconciliation.justification != '' THEN 'justified'
      ELSE 'divergent'
    END,
    updated_at = now();

  RETURN v_count;
END;
$$;
