
-- Drop existing policies
DROP POLICY IF EXISTS "Admins can manage projetos" ON public.projetos;
DROP POLICY IF EXISTS "Authenticated users can manage projetos" ON public.projetos;
DROP POLICY IF EXISTS "Authenticated users can read projetos" ON public.projetos;
DROP POLICY IF EXISTS "Authenticated users can update projetos" ON public.projetos;

-- Recreate with correct auth check
CREATE POLICY "Auth users can select projetos"
  ON public.projetos FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert projetos"
  ON public.projetos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update projetos"
  ON public.projetos FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete projetos"
  ON public.projetos FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);
