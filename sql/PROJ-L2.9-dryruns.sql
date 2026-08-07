-- =====================================================================
-- PROJ-L2.9 — Dry-runs do L2 (item L2.6 do plano)
-- Projeto Supabase: hbtggrbauguukewiknew
--
-- ESTADO: rodar DEPOIS de PROJ-L2.1, L2.2, L2.3 e L2.4 aplicados.
--
-- NADA E PERSISTIDO: tudo dentro de BEGIN ... ROLLBACK.
-- Simula a Ana (nao-admin, responsavel dos 2 projetos reais) via
-- request.jwt.claims + set local role authenticated.
--
-- Regra 8 do plano: teste final SEMPRE com usuario nao-admin. O Pedro e o
-- unico is_admin=true e passa por bypass em tudo — erro de permissao nunca
-- apareceria para ele.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BLOCO A — cenarios felizes e de rejeicao por teto (rodar inteiro)
-- ---------------------------------------------------------------------
begin;

-- captura (criada como postgres, liberada para a role simulada)
create temp table _dryrun (etapa text, retorno jsonb) on commit drop;
grant all on table _dryrun to authenticated;

-- vira a Ana
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;

-- CENARIO 1 — edita um pedido do Actual MANTENDO o valor => success:true
insert into _dryrun
select '1_editar_mantendo_valor',
       public.projeto_pedido_salvar(r.projeto_id, r.id, jsonb_build_object(
         'descricao', r.descricao || ' [dry-run]',
         'fornecedor_codigo', r.fornecedor_codigo,
         'fornecedor_nome', r.fornecedor_nome,
         'fornecedor_cnpj', r.fornecedor_cnpj,
         'cond_pagamento_codigo', r.cond_pagamento_codigo,
         'cond_pagamento_nome', r.cond_pagamento_nome,
         'itens', r.itens, 'classe_rateio', r.classe_rateio,
         'valor_total', r.valor_total, 'fase', r.fase))
  from public.projeto_requisicoes r
  join public.projetos p on p.id = r.projeto_id
 where p.nome = 'Congresso Rio Valves' and r.fase = 'actual'
 order by r.sequencia limit 1;

-- CENARIO 2 — mesmo pedido, +1.000 => success:false + evento teto_rejeitado
insert into _dryrun
select '2_estourar_teto',
       public.projeto_pedido_salvar(r.projeto_id, r.id, jsonb_build_object(
         'descricao', r.descricao,
         'fornecedor_codigo', r.fornecedor_codigo,
         'fornecedor_nome', r.fornecedor_nome,
         'fornecedor_cnpj', r.fornecedor_cnpj,
         'cond_pagamento_codigo', r.cond_pagamento_codigo,
         'cond_pagamento_nome', r.cond_pagamento_nome,
         'itens', r.itens, 'classe_rateio', r.classe_rateio,
         'valor_total', r.valor_total + 1000, 'fase', r.fase))
  from public.projeto_requisicoes r
  join public.projetos p on p.id = r.projeto_id
 where p.nome = 'Congresso Rio Valves' and r.fase = 'actual'
 order by r.sequencia limit 1;

-- CENARIO 3 — exclui um rascunho do Actual => deleted:true
insert into _dryrun
select '3_excluir_rascunho',
       public.projeto_pedido_excluir(r.id)
  from public.projeto_requisicoes r
  join public.projetos p on p.id = r.projeto_id
 where p.nome = 'Congresso Rio Valves' and r.fase = 'actual' and r.status = 'rascunho'
 order by r.sequencia desc limit 1;

reset role;

select d.etapa,
       d.retorno->>'success'          as success,
       d.retorno->>'erro_codigo'      as erro_codigo,
       d.retorno->>'mensagem'         as mensagem,
       d.retorno->>'saldo_disponivel' as saldo,
       coalesce(d.retorno->'pedido'->>'sequencia',   d.retorno->>'sequencia')   as seq,
       coalesce(d.retorno->'pedido'->>'valor_total', d.retorno->>'valor_total') as valor,
       d.retorno->'pedido'->>'atualizado_por' as atualizado_por
  from _dryrun d order by d.etapa;

select e.evento, e.fase, e.valor_antes, e.valor_depois, e.usuario_email, e.detalhes
  from public.projeto_eventos e order by e.created_at;

rollback;

-- Esperado:
--   1_editar_mantendo_valor : success=true,  atualizado_por = uuid da Ana
--   2_estourar_teto         : success=false, erro_codigo=teto_excedido, saldo=0.00
--   3_excluir_rascunho      : success=true (deleted)
--   eventos: pedido_editado, teto_rejeitado, pedido_excluido — todos com
--            usuario_email preenchido (prova de que profiles.user_id resolveu)


-- ---------------------------------------------------------------------
-- BLOCO B — teste NEGATIVO (D-12). Aborta com excecao de proposito.
-- Rodar separado; a excecao e o resultado esperado.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;

-- pedido da fase budget com o projeto em actual => deve levantar excecao
select public.projeto_pedido_salvar(r.projeto_id, r.id,
         jsonb_build_object('descricao', r.descricao, 'itens', r.itens,
                            'classe_rateio', r.classe_rateio,
                            'valor_total', r.valor_total, 'fase', 'budget'))
  from public.projeto_requisicoes r
  join public.projetos p on p.id = r.projeto_id
 where p.nome = 'Congresso Rio Valves' and r.fase = 'budget'
 order by r.sequencia limit 1;

rollback;

-- Esperado: ERRO —
--   'Pedido da fase "budget" não pode ser gravado com o projeto na fase "actual"'
