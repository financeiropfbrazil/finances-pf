
-- Add bank_code column to bank_statement_transactions
ALTER TABLE public.bank_statement_transactions ADD COLUMN bank_code text NOT NULL DEFAULT '';

-- Add bank_code column to erp_transactions
ALTER TABLE public.erp_transactions ADD COLUMN bank_code text NOT NULL DEFAULT '';
