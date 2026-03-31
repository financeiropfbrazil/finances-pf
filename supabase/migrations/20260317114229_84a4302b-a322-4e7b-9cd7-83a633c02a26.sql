ALTER TABLE public.credit_card_transactions
  ADD COLUMN cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL;