
-- Drop overly permissive policies
DROP POLICY "Authenticated users can insert periods" ON public.periods;
DROP POLICY "Authenticated users can update periods" ON public.periods;

-- Recreate with explicit auth check
CREATE POLICY "Authenticated users can insert periods"
ON public.periods FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update periods"
ON public.periods FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL);
