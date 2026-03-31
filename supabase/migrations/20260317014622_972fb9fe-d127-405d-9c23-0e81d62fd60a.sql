
CREATE TABLE public.credit_card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.credit_card_invoices(id) ON DELETE CASCADE NOT NULL,
  card_id uuid REFERENCES public.credit_cards(id) ON DELETE CASCADE NOT NULL,
  transaction_date date NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  transaction_type text DEFAULT 'debit',
  category text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.credit_card_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select credit_card_transactions" ON public.credit_card_transactions FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert credit_card_transactions" ON public.credit_card_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update credit_card_transactions" ON public.credit_card_transactions FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete credit_card_transactions" ON public.credit_card_transactions FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
