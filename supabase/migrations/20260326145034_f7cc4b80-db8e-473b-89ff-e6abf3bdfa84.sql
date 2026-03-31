
-- Drop the overly broad UPDATE and DELETE policies that override bloqueado check
DROP POLICY IF EXISTS "Authenticated users can update requisicoes" ON public.projeto_requisicoes;
DROP POLICY IF EXISTS "Authenticated users can delete requisicoes" ON public.projeto_requisicoes;

-- The remaining policies are:
-- "Users can update projeto_requisicoes" with USING (bloqueado = false OR admin) - no WITH CHECK
-- "Users can delete projeto_requisicoes" with USING (bloqueado = false OR admin)
-- "Authenticated users can read requisicoes" for SELECT
-- "Authenticated users can insert requisicoes" for INSERT
