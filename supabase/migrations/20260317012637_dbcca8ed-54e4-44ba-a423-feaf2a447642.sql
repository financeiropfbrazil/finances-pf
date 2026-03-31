-- Remove duplicate overly permissive RLS policies on intercompany_alvo_docs
-- Keep the auth.uid() IS NOT NULL ones (more restrictive), drop the 'true' ones

DROP POLICY IF EXISTS "intercompany_alvo_docs_insert" ON public.intercompany_alvo_docs;
DROP POLICY IF EXISTS "intercompany_alvo_docs_select" ON public.intercompany_alvo_docs;
DROP POLICY IF EXISTS "intercompany_alvo_docs_update" ON public.intercompany_alvo_docs;

-- Also add the missing UPDATE policy for public role with auth check
CREATE POLICY "Auth users can update intercompany_alvo_docs"
ON public.intercompany_alvo_docs
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);