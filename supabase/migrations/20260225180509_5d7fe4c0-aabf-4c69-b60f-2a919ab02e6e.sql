
-- Add closing fields to reconciliation_summary
ALTER TABLE public.reconciliation_summary
ADD COLUMN closed_at timestamp with time zone DEFAULT NULL,
ADD COLUMN closed_by uuid DEFAULT NULL;
