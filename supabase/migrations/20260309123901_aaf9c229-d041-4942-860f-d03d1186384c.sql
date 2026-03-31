
-- Create depreciation_history table
CREATE TABLE public.depreciation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.periods(id),
  asset_id uuid NOT NULL REFERENCES public.fixed_assets_items(id) ON DELETE CASCADE,
  asset_code text NOT NULL,
  category_id uuid REFERENCES public.fixed_assets_categories(id),
  gross_value numeric NOT NULL,
  depreciation_before numeric NOT NULL,
  depreciation_amount numeric NOT NULL,
  depreciation_after numeric NOT NULL,
  net_value_after numeric NOT NULL,
  useful_life_months integer,
  monthly_rate numeric,
  months_elapsed integer,
  is_fully_depreciated boolean DEFAULT false,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE (period_id, asset_id)
);

CREATE INDEX idx_depreciation_history_period ON public.depreciation_history(period_id);
CREATE INDEX idx_depreciation_history_asset ON public.depreciation_history(asset_id);
CREATE INDEX idx_depreciation_history_category ON public.depreciation_history(category_id);

ALTER TABLE public.depreciation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view depreciation_history" ON public.depreciation_history FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert depreciation_history" ON public.depreciation_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update depreciation_history" ON public.depreciation_history FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete depreciation_history" ON public.depreciation_history FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Update calculate_monthly_depreciation to record history
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
  v_dep_before numeric;
  v_period_end date;
  v_count integer := 0;
  v_period RECORD;
  v_months integer;
  v_rate numeric;
  v_life integer;
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

    v_dep_before := v_item.accumulated_depreciation;

    IF v_cat IS NOT NULL AND v_cat.depreciable = false THEN
      UPDATE public.fixed_assets_items
        SET accumulated_depreciation = 0
        WHERE id = v_item.id AND accumulated_depreciation != 0;

      INSERT INTO public.depreciation_history (period_id, asset_id, asset_code, category_id, gross_value, depreciation_before, depreciation_amount, depreciation_after, net_value_after, useful_life_months, monthly_rate, months_elapsed, is_fully_depreciated)
      VALUES (p_period_id, v_item.id, v_item.asset_code, v_cat.id, v_item.gross_value, v_dep_before, 0, 0, v_item.gross_value, NULL, NULL, NULL, false)
      ON CONFLICT (period_id, asset_id) DO UPDATE SET
        gross_value = EXCLUDED.gross_value, depreciation_before = EXCLUDED.depreciation_before,
        depreciation_amount = 0, depreciation_after = 0, net_value_after = EXCLUDED.net_value_after,
        is_fully_depreciated = false, calculated_at = now();
      CONTINUE;
    END IF;

    IF v_item.acquisition_date IS NULL THEN
      CONTINUE;
    END IF;

    v_dep_monthly := 0;
    v_rate := 0;
    v_life := 0;

    IF COALESCE(v_item.monthly_depreciation_rate, 0) > 0 THEN
      v_rate := v_item.monthly_depreciation_rate;
      v_life := v_item.useful_life_months;
      v_dep_monthly := v_item.gross_value * (v_rate / 100.0);
    ELSIF COALESCE(v_item.useful_life_months, 0) > 0 THEN
      v_life := v_item.useful_life_months;
      v_rate := ROUND(100.0 / v_life, 4);
      v_dep_monthly := v_item.gross_value / v_life;
    ELSIF v_cat IS NOT NULL AND COALESCE(v_cat.default_monthly_rate, 0) > 0 THEN
      v_rate := v_cat.default_monthly_rate;
      v_life := v_cat.default_useful_life_months;
      v_dep_monthly := v_item.gross_value * (v_rate / 100.0);
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

    -- Record history
    INSERT INTO public.depreciation_history (
      period_id, asset_id, asset_code, category_id, gross_value,
      depreciation_before, depreciation_amount, depreciation_after, net_value_after,
      useful_life_months, monthly_rate, months_elapsed, is_fully_depreciated
    ) VALUES (
      p_period_id, v_item.id, v_item.asset_code,
      CASE WHEN v_cat IS NOT NULL THEN v_cat.id ELSE NULL END,
      v_item.gross_value,
      v_dep_before,
      v_dep_total - v_dep_before,
      v_dep_total,
      v_item.gross_value - v_dep_total,
      v_life, v_rate, v_months,
      v_dep_total >= v_item.gross_value
    )
    ON CONFLICT (period_id, asset_id) DO UPDATE SET
      asset_code = EXCLUDED.asset_code,
      category_id = EXCLUDED.category_id,
      gross_value = EXCLUDED.gross_value,
      depreciation_before = EXCLUDED.depreciation_before,
      depreciation_amount = EXCLUDED.depreciation_amount,
      depreciation_after = EXCLUDED.depreciation_after,
      net_value_after = EXCLUDED.net_value_after,
      useful_life_months = EXCLUDED.useful_life_months,
      monthly_rate = EXCLUDED.monthly_rate,
      months_elapsed = EXCLUDED.months_elapsed,
      is_fully_depreciated = EXCLUDED.is_fully_depreciated,
      calculated_at = now();

    v_count := v_count + 1;
  END LOOP;

  -- Update fixed_assets_summary
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

  -- Update reconciliation per category
  INSERT INTO public.fixed_assets_reconciliation (period_id, category_id, account_asset, account_depreciation, gross_value, accumulated_depreciation)
  SELECT p_period_id, cat.id, cat.account_asset, cat.account_depreciation,
    COALESCE(SUM(fi.gross_value), 0), COALESCE(SUM(fi.accumulated_depreciation), 0)
  FROM public.fixed_assets_categories cat
  LEFT JOIN public.fixed_assets_items fi ON fi.category_id = cat.id AND fi.period_id = p_period_id AND fi.status = 'ativo'
  GROUP BY cat.id, cat.account_asset, cat.account_depreciation
  ON CONFLICT (period_id, category_id) DO UPDATE SET
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
