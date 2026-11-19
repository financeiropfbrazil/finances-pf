-- NFE-15 — rollback. Só com ordem do Pedro. ⚠️ Apaga os comentários já feitos: antes, guardar uma cópia
--   (create table public.zz_bkp_nota_comentario_<data> as select * from public.nota_comentario;).
-- Reverter o commit da tela junto (sem as funções, a etapa 7 mostra o erro e as outras 6 seguem funcionando).
drop function if exists public.nota_comentario_adicionar(text, text, text);
drop function if exists public.nota_comentarios(text, text);
drop table if exists public.nota_comentario;
