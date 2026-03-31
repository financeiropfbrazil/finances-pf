
-- Add payment/settlement columns to intercompany
ALTER TABLE public.intercompany
  ADD COLUMN docfin_key integer,
  ADD COLUMN payment_status text NOT NULL DEFAULT 'em_aberto',
  ADD COLUMN payment_date date,
  ADD COLUMN payment_exchange_rate numeric,
  ADD COLUMN payment_amount_brl numeric,
  ADD COLUMN fx_variation numeric,
  ADD COLUMN payment_additions numeric,
  ADD COLUMN payment_deductions numeric,
  ADD COLUMN payment_discount numeric,
  ADD COLUMN payment_updated_at timestamptz;

-- Indexes
CREATE INDEX idx_intercompany_payment_status ON public.intercompany (payment_status);
CREATE INDEX idx_intercompany_payment_date ON public.intercompany (payment_date);
CREATE INDEX idx_intercompany_docfin_key ON public.intercompany (docfin_key);
