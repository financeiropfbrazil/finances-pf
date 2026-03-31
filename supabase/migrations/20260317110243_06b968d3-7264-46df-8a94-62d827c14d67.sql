
CREATE OR REPLACE FUNCTION public.soft_delete_credit_card(p_card_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.credit_cards
  SET is_active = false
  WHERE id = p_card_id;
END;
$$;
