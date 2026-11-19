-- NFE-3-B — conferência (só leitura)
select md5(prosrc) md5, proacl::text acl from pg_proc where oid = 'public.nfe_recebida_detalhe(uuid)'::regprocedure;
-- esperado: md5 1187ebfbbe9926ddf4fb7195189b2266 · {postgres=X,authenticated=X,service_role=X}

begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select c.numero, c.status_lancamento, jsonb_array_length(public.nfe_recebida_detalhe(c.id)->'pedidos'->'vinculo_hub') vinculo_hub_mostrado
from public.compras_nfe c where c.numero in ('1139', '1562', '6626', '11036', '11068') and c.data_emissao between '2026-05-01' and '2026-06-30';
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado (migration nfe_3b_vinculo_hub_so_nota_vinculada), pré-voo ok (md5 anterior a3efe598…).
-- Órfãs 1139, 1562, 6626 (pendente): vínculo do Hub 0 — antes apareciam. 11036 e 11068 (vinculada): 1 cada — ok.
-- As 3 linhas órfãs continuam em compras_nfe_pedidos (nada apagado); apagar fica a critério do Pedro.
