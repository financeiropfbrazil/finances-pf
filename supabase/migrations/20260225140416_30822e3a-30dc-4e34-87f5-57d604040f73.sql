
-- Create reconciliation_summary table
CREATE TABLE public.reconciliation_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  accounting_account TEXT NOT NULL,
  management_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  accounting_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference NUMERIC(18,2) GENERATED ALWAYS AS (management_balance - accounting_balance) STORED,
  status TEXT NOT NULL DEFAULT 'divergent' CHECK (status IN ('reconciled', 'justified', 'divergent')),
  justification TEXT,
  responsible_user UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(period_id, module_name)
);

-- Enable RLS
ALTER TABLE public.reconciliation_summary ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view reconciliation_summary"
  ON public.reconciliation_summary FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert reconciliation_summary"
  ON public.reconciliation_summary FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update reconciliation_summary"
  ON public.reconciliation_summary FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_reconciliation_summary_updated_at
  BEFORE UPDATE ON public.reconciliation_summary
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
