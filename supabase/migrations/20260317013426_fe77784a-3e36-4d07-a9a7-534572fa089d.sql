
-- Create credit_cards table
CREATE TABLE public.credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_name text NOT NULL,
  last_four text NOT NULL,
  bank_name text NOT NULL,
  network text NOT NULL,
  due_day integer NOT NULL,
  card_color text NOT NULL DEFAULT '#1a1a2e',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select credit_cards" ON public.credit_cards FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert credit_cards" ON public.credit_cards FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update credit_cards" ON public.credit_cards FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete credit_cards" ON public.credit_cards FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Create credit_card_invoices table
CREATE TABLE public.credit_card_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid REFERENCES public.credit_cards(id) ON DELETE CASCADE NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  total_amount numeric(12,2) DEFAULT 0,
  status text DEFAULT 'aberta',
  due_date date,
  payment_date date,
  created_at timestamptz DEFAULT now(),
  UNIQUE(card_id, year, month)
);

ALTER TABLE public.credit_card_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select credit_card_invoices" ON public.credit_card_invoices FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert credit_card_invoices" ON public.credit_card_invoices FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update credit_card_invoices" ON public.credit_card_invoices FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete credit_card_invoices" ON public.credit_card_invoices FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
