-- NFE-16 — conferência (só leitura; tudo dentro de begin … rollback)
select p.oid::regprocedure, p.proacl::text, has_function_privilege('anon', p.oid, 'execute') anon
from pg_proc p where p.proname = 'nota_comentarios_lote';
-- esperado: {postgres=X,authenticated=X,service_role=X} · anon false

-- Hugo (Analista Fiscal) lê os comentários das NF-e de uma vez; chave inexistente é ignorada; cada lista em ordem decrescente
begin;
create temp table _t16 as
  select array_agg(distinct chave_acesso) || array['00000000000000000000000000000000000000000000'] chaves,
         (select user_id from public.profiles where email = 'hugo.maffei@pfbrazil.com') hugo
  from public.nota_comentario where tipo = 'nfe';
grant select on _t16 to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select hugo from _t16), 'role', 'authenticated')::text, true);
set local role authenticated;
select jsonb_array_length(r) notas,
       (select sum(jsonb_array_length(e->'comentarios')) from jsonb_array_elements(r) e) comentarios,
       (select bool_and((e->'comentarios'->0->>'criado_em') >= (e->'comentarios'->-1->>'criado_em')) from jsonb_array_elements(r) e) decrescente
from (select public.nota_comentarios_lote('nfe', (select chaves from _t16)) r) x;
rollback;
-- 11/11/2026: 1 nota · 3 comentários · true

-- Mirlene (Operador de Compras): NFS-e passa; NF-e 42501; 5.001 chaves e tipo inválido → 22023
begin;
create temp table _t16 as select (select user_id from public.profiles where email = 'mirlene.oliveira@pfbrazil.com') mirlene;
grant select on _t16 to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select mirlene from _t16), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table _r16 (caso text, resultado text);
do $$
begin
  insert into _r16 values ('mirlene nfse', public.nota_comentarios_lote('nfse', array['x'])::text);
  begin perform public.nota_comentarios_lote('nfe', array['x']); insert into _r16 values ('mirlene nfe', 'passou (ERRADO)');
  exception when others then insert into _r16 values ('mirlene nfe', sqlstate || ' ' || sqlerrm); end;
  begin perform public.nota_comentarios_lote('nfse', array(select g::text from generate_series(1, 5001) g)); insert into _r16 values ('5001 chaves', 'passou (ERRADO)');
  exception when others then insert into _r16 values ('5001 chaves', sqlstate || ' ' || sqlerrm); end;
  begin perform public.nota_comentarios_lote('xpto', array['x']); insert into _r16 values ('tipo inválido', 'passou (ERRADO)');
  exception when others then insert into _r16 values ('tipo inválido', sqlstate || ' ' || sqlerrm); end;
end $$;
select * from _r16;
rollback;
-- esperado: [] · 42501 Sem permissão para Notas Fiscais · 22023 No máximo 5.000 notas por chamada · 22023 Tipo de nota inválido
