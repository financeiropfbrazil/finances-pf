-- NFE-14 — rollback: remove a função nova (nada existente mudou). Só com ordem do Pedro; reverter o commit da tela junto
-- (sem a função, a coluna "Tipo lanç." fica vazia e o Excel sai sem o tipo — a tela não quebra).
drop function if exists public.alvo_tipo_lanc(bigint[]);
