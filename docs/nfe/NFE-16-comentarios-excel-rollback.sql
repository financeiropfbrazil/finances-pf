-- NFE-16 — rollback. Só com ordem do Pedro. Não apaga comentário nenhum (a função só lê).
-- Reverter o commit da tela junto (sem a função, o download do Excel falha ao buscar os comentários).
drop function if exists public.nota_comentarios_lote(text, text[]);
