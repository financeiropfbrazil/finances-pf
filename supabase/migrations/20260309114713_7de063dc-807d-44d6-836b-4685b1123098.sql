
-- Create fixed_assets_reconciliation table
CREATE TABLE public.fixed_assets_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.periods(id),
  category_id uuid NOT NULL REFERENCES public.fixed_assets_categories(id),
  account_asset text NOT NULL,
  account_depreciation text,
  gross_value numeric NOT NULL DEFAULT 0,
  accumulated_depreciation numeric NOT NULL DEFAULT 0,
  net_value numeric,
  accounting_balance_asset numeric DEFAULT 0,
  accounting_balance_depreciation numeric DEFAULT 0,
  accounting_net numeric,
  difference numeric,
  status text NOT NULL DEFAULT 'pending',
  justification text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, category_id)
);

-- Indexes
CREATE INDEX idx_fixed_assets_reconciliation_period_id ON public.fixed_assets_reconciliation(period_id);
CREATE INDEX idx_fixed_assets_reconciliation_status ON public.fixed_assets_reconciliation(status);

-- RLS
ALTER TABLE public.fixed_assets_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view fixed_assets_reconciliation"
  ON public.fixed_assets_reconciliation FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert fixed_assets_reconciliation"
  ON public.fixed_assets_reconciliation FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update fixed_assets_reconciliation"
  ON public.fixed_assets_reconciliation FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete fixed_assets_reconciliation"
  ON public.fixed_assets_reconciliation FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- updated_at trigger
CREATE TRIGGER trg_fixed_assets_reconciliation_updated_at
  BEFORE UPDATE ON public.fixed_assets_reconciliation
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
