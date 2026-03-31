
CREATE OR REPLACE FUNCTION public.find_or_create_period(p_competence_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer;
  v_month integer;
  v_period_id uuid;
BEGIN
  v_year := EXTRACT(YEAR FROM p_competence_date);
  v_month := EXTRACT(MONTH FROM p_competence_date);

  SELECT id INTO v_period_id
  FROM public.periods
  WHERE year = v_year AND month = v_month
  LIMIT 1;

  IF v_period_id IS NOT NULL THEN
    RETURN v_period_id;
  END IF;

  INSERT INTO public.periods (year, month, status)
  VALUES (v_year, v_month, 'open')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_period_id
  FROM public.periods
  WHERE year = v_year AND month = v_month
  LIMIT 1;

  RETURN v_period_id;
END;
$$;
