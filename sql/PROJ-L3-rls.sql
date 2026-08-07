-- =====================================================================
-- PROJ-L3 — RLS: fecha a escrita direta e migra o escopo para responsavel_id
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L3) · decisao D-14
--
-- ESTADO: PENDENTE de aplicacao.
--
-- ############  LOTE DE MAIOR RISCO DO PLANO  ############
-- Este lote RETIRA as policies que hoje permitem escrita direta em
-- projeto_requisicoes. Depois dele, usuario comum SO escreve via as RPCs do L2.
-- Se as RPCs nao estiverem no ar, o modulo para de gravar.
--
-- PRE-REQUISITO OBRIGATORIO (ja satisfeito e verificado em 07/08):
--   L2 aplicado e validado por dry-run — as 6 funcoes existem, com
--   security_definer=true e search_path=public,auth:
--     projeto_evento_log · projeto_pedido_salvar · projeto_pedido_excluir
--     projeto_pedido_marcar_enviado · enviar_budget_para_aprovacao
--     aprovar_budget_projeto
--   Confira antes de rodar (deve retornar 6):
--     select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.prosecdef
--        and p.proname in ('projeto_evento_log','projeto_pedido_salvar',
--            'projeto_pedido_excluir','projeto_pedido_marcar_enviado',
--            'enviar_budget_para_aprovacao','aprovar_budget_projeto');
--
-- ⚠️ O FRONT AINDA E O ANTIGO ate o L4. Entre este lote e o L4, o
--    ProjetoRequisicoes.tsx (que usa .upsert()/.delete() direto) VAI FALHAR para
--    nao-admin. Isso e esperado e e a razao da ordem L3 -> L4. O app publicado so
--    muda com Publish manual; o push do L4 vem logo em seguida.
--
-- O QUE MUDA
--   projeto_requisicoes : DROP das policies de INSERT/UPDATE/DELETE.
--                         SELECT reescrito por responsavel_id/aprovador_id.
--                         Escrita direta passa a existir SO para admin
--                         (rede de seguranca para o Pedro operar pelo SQL Editor).
--   projetos            : SELECT/UPDATE/DELETE migrados de criado_por para
--                         responsavel_id. D-14: ramo edit_own SOBREVIVE (senao a
--                         edicao de projeto pelo Responsavel morre — o L4.3 a
--                         mantem); ramo do aprovador SAI (aprovar_budget_projeto
--                         faz o UPDATE por dentro, provado no L0.2).
--                         INSERT: NAO E TOCADO (fica como esta — L3.2.3).
--   projeto_eventos     : ganha SELECT com o escopo do projeto pai.
--                         ZERO policy de escrita — so as RPCs inserem.
--
-- FORA DESTE LOTE: projeto_pedido_auditoria continua com escopo criado_por
--   (pendencia P-5 do plano).
--
-- Idempotente: todos os DROP sao IF EXISTS; os CREATE vem depois do DROP do
-- mesmo nome. Pode rodar 2x.
-- =====================================================================


-- =====================================================================
-- 1) projeto_requisicoes
-- =====================================================================

-- 1.1 remove a escrita direta (as tres policies que o L2 substituiu)
drop policy if exists projeto_requisicoes_insert on public.projeto_requisicoes;
drop policy if exists projeto_requisicoes_update on public.projeto_requisicoes;
drop policy if exists projeto_requisicoes_delete on public.projeto_requisicoes;

-- 1.2 SELECT reescrito: escopo por responsavel_id (titularidade oficial) e
--     aprovador_id. criado_por sai do escopo de visao.
drop policy if exists projeto_requisicoes_select on public.projeto_requisicoes;
drop policy if exists pr_select on public.projeto_requisicoes;

create policy pr_select
  on public.projeto_requisicoes
  for select
  to authenticated
  using (
    _is_admin()
    or exists (
      select 1 from public.projetos pr
       where pr.id = projeto_requisicoes.projeto_id
         and ( _user_has_perm('projetos.view_all')
               or ( _user_has_perm('projetos.view_own')
                    and ( pr.responsavel_id = auth.uid()
                          or pr.aprovador_id = auth.uid() ) ) )
    )
  );

-- 1.3 escrita direta: SO admin (rede de seguranca). Todo o resto via RPC.
--     FOR ALL tambem cobre SELECT, mas policies PERMISSIVE se somam por OR —
--     entao o SELECT efetivo e (pr_select OR admin). Nao restringe ninguem.
drop policy if exists pr_escrita_admin on public.projeto_requisicoes;

create policy pr_escrita_admin
  on public.projeto_requisicoes
  for all
  to authenticated
  using (_is_admin())
  with check (_is_admin());


-- =====================================================================
-- 2) projetos   (INSERT nao e tocado — permanece projetos_insert como esta)
-- =====================================================================

-- 2.1 SELECT: criado_por -> responsavel_id
drop policy if exists projetos_select on public.projetos;

create policy projetos_select
  on public.projetos
  for select
  to authenticated
  using (
    _is_admin()
    or _user_has_perm('projetos.view_all')
    or ( _user_has_perm('projetos.view_own')
         and ( responsavel_id = auth.uid() or aprovador_id = auth.uid() ) )
  );

-- 2.2 UPDATE (D-14): edit_own sobrevive migrado para responsavel_id;
--     ramo do aprovador SAI (a RPC faz o UPDATE por dentro).
drop policy if exists projetos_update on public.projetos;

create policy projetos_update
  on public.projetos
  for update
  to authenticated
  using (
    _is_admin()
    or ( _user_has_perm('projetos.edit_own')
         and responsavel_id = auth.uid()
         and fase_atual = 'budget' )
  )
  with check (
    _is_admin()
    or ( _user_has_perm('projetos.edit_own')
         and responsavel_id = auth.uid() )
  );

-- 2.3 DELETE: mesma migracao de titularidade
drop policy if exists projetos_delete on public.projetos;

create policy projetos_delete
  on public.projetos
  for delete
  to authenticated
  using (
    _is_admin()
    or ( _user_has_perm('projetos.delete_own')
         and responsavel_id = auth.uid()
         and fase_atual = 'budget' )
  );


-- =====================================================================
-- 3) projeto_eventos — SELECT com escopo do projeto pai; ZERO escrita
-- =====================================================================
drop policy if exists projeto_eventos_select on public.projeto_eventos;

create policy projeto_eventos_select
  on public.projeto_eventos
  for select
  to authenticated
  using (
    _is_admin()
    or exists (
      select 1 from public.projetos pr
       where pr.id = projeto_eventos.projeto_id
         and ( _user_has_perm('projetos.view_all')
               or ( _user_has_perm('projetos.view_own')
                    and ( pr.responsavel_id = auth.uid()
                          or pr.aprovador_id = auth.uid() ) ) )
    )
  );
-- Nenhuma policy de INSERT/UPDATE/DELETE aqui, de proposito: a tabela e
-- append-only e so as RPCs SECURITY DEFINER escrevem (padrao OP).


-- =====================================================================
-- 4) PostgREST
-- =====================================================================
notify pgrst, 'reload schema';


-- =====================================================================
-- 5) VERIFICACAO POR LEITURA — pg_policies completo das tabelas do modulo
--    (Regra 6: releitura e o unico criterio de "concluido")
-- =====================================================================

-- 5.1 Snapshot integral
select tablename, policyname, cmd, permissive, roles::text as roles, qual, with_check
  from pg_policies
 where schemaname='public'
   and tablename in ('projetos','projeto_requisicoes','projeto_eventos','projeto_pedido_auditoria')
 order by tablename, cmd, policyname;

-- 5.2 Resumo — e o jeito rapido de ver se o lote pegou
select tablename,
       string_agg(distinct cmd, ', ' order by cmd) as comandos_com_policy,
       count(*) as qtd_policies
  from pg_policies
 where schemaname='public'
   and tablename in ('projetos','projeto_requisicoes','projeto_eventos','projeto_pedido_auditoria')
 group by tablename
 order by tablename;
-- Esperado:
--   projetos                 : DELETE, INSERT, SELECT, UPDATE            | 4
--   projeto_requisicoes      : ALL, SELECT                               | 2   <= sem INSERT/UPDATE/DELETE proprios
--   projeto_eventos          : SELECT                                    | 1   <= zero escrita
--   projeto_pedido_auditoria : INSERT, SELECT                            | 2   (inalterada — P-5)

-- 5.3 Checagem objetiva da migracao de titularidade
select 'projeto_requisicoes ainda cita criado_por' as checagem,
       exists (select 1 from pg_policies where schemaname='public'
                and tablename='projeto_requisicoes'
                and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%criado_por%') as resultado,
       false as esperado
union all
select 'projetos ainda cita criado_por fora do INSERT',
       exists (select 1 from pg_policies where schemaname='public'
                and tablename='projetos' and cmd <> 'INSERT'
                and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%criado_por%'),
       false
union all
select 'projeto_requisicoes usa responsavel_id',
       exists (select 1 from pg_policies where schemaname='public'
                and tablename='projeto_requisicoes'
                and coalesce(qual,'') ilike '%responsavel_id%'),
       true
union all
select 'projetos usa responsavel_id',
       exists (select 1 from pg_policies where schemaname='public'
                and tablename='projetos'
                and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%responsavel_id%'),
       true
union all
select 'projeto_eventos sem policy de escrita',
       not exists (select 1 from pg_policies where schemaname='public'
                    and tablename='projeto_eventos' and cmd <> 'SELECT'),
       true;

-- 5.4 RLS continua ligado nas 3 tabelas
select c.relname as tabela, c.relrowsecurity as rls_on
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('projetos','projeto_requisicoes','projeto_eventos')
 order by c.relname;
-- Esperado: true nas tres


-- =====================================================================
-- 6) SMOKE TEST pos-L3 (opcional, mas recomendado neste lote)
--    Regra 10: SEM temp table. Rodar UM BLOCO DE CADA VEZ; cada um tem um
--    unico select final e termina em ROLLBACK — nada persiste.
--    Simula a Ana (nao-admin, responsavel dos 2 projetos reais).
-- =====================================================================

-- 6.A — UPDATE direto deve ser BLOQUEADO (0 linhas afetadas, sem erro:
--       a policy filtra a linha, nao levanta excecao)
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;
with upd as (
  update public.projeto_requisicoes r
     set descricao = r.descricao
   where r.id = (select r2.id from public.projeto_requisicoes r2
                   join public.projetos p on p.id = r2.projeto_id
                  where p.nome='Congresso Rio Valves' and r2.fase='actual'
                  order by r2.sequencia limit 1)
  returning 1
)
select count(*) as linhas_afetadas_esperado_0 from upd;
rollback;
*/

-- 6.B — DELETE direto deve ser BLOQUEADO (0 linhas afetadas)
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;
with del as (
  delete from public.projeto_requisicoes r
   where r.id = (select r2.id from public.projeto_requisicoes r2
                   join public.projetos p on p.id = r2.projeto_id
                  where p.nome='Congresso Rio Valves' and r2.fase='actual'
                    and r2.status='rascunho'
                  order by r2.sequencia desc limit 1)
  returning 1
)
select count(*) as linhas_afetadas_esperado_0 from del;
rollback;
*/

-- 6.C — a RPC continua funcionando (este e o teste que prova que o modulo
--       nao morreu): esperado success=true
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;
select public.projeto_pedido_salvar(r.projeto_id, r.id, jsonb_build_object(
         'descricao', r.descricao || ' [smoke L3]',
         'fornecedor_codigo', r.fornecedor_codigo,
         'fornecedor_nome', r.fornecedor_nome,
         'fornecedor_cnpj', r.fornecedor_cnpj,
         'cond_pagamento_codigo', r.cond_pagamento_codigo,
         'cond_pagamento_nome', r.cond_pagamento_nome,
         'itens', r.itens, 'classe_rateio', r.classe_rateio,
         'valor_total', r.valor_total, 'fase', r.fase)) as resultado
  from public.projeto_requisicoes r
  join public.projetos p on p.id = r.projeto_id
 where p.nome = 'Congresso Rio Valves' and r.fase = 'actual'
 order by r.sequencia limit 1;
rollback;
*/

-- 6.D — a Ana continua ENXERGANDO os pedidos pelo novo escopo
--       (se isto voltar 0, o SELECT foi fechado indevidamente)
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;
select count(*) as pedidos_visiveis_esperado_20,
       (select count(*) from public.projetos)        as projetos_visiveis_esperado_2,
       (select count(*) from public.projeto_eventos) as eventos_visiveis_esperado_0
  from public.projeto_requisicoes;
rollback;
*/
-- Esperado em 6.D: 20 pedidos (os 2 projetos da Ana; os 3 do projeto "teste",
-- do Pedro, ficam fora) · 2 projetos · 0 eventos (tabela ainda vazia).


-- =====================================================================
-- ROLLBACK COMPLETO DO L3
-- Restaura EXATAMENTE as policies medidas no L0 (secao 10.2 do plano).
-- Rodar inteiro devolve o modulo ao estado pre-L3 — inclusive a escrita
-- direta que o front antigo usa.
-- =====================================================================
/*
-- --- projeto_requisicoes: volta ao estado do baseline ---
drop policy if exists pr_select        on public.projeto_requisicoes;
drop policy if exists pr_escrita_admin on public.projeto_requisicoes;

create policy projeto_requisicoes_select on public.projeto_requisicoes
  for select to authenticated
  using (exists ( select 1 from projetos pr
                   where pr.id = projeto_requisicoes.projeto_id
                     and (_is_admin() or _user_has_perm('projetos.view_all')
                          or (_user_has_perm('projetos.view_own')
                              and (pr.criado_por = auth.uid() or pr.aprovador_id = auth.uid())))));

create policy projeto_requisicoes_insert on public.projeto_requisicoes
  for insert to authenticated
  with check (_is_admin() or (_user_has_perm('projetos.pedidos.create')
    and exists ( select 1 from projetos pr
                  where pr.id = projeto_requisicoes.projeto_id
                    and pr.criado_por = auth.uid()
                    and pr.fase_atual = 'budget'
                    and projeto_requisicoes.fase = 'budget')));

create policy projeto_requisicoes_update on public.projeto_requisicoes
  for update to authenticated
  using (_is_admin() or (exists ( select 1 from projetos pr
          where pr.id = projeto_requisicoes.projeto_id
            and pr.criado_por = auth.uid()
            and _user_has_perm('projetos.pedidos.create')
            and (((pr.fase_atual = 'budget') and (projeto_requisicoes.fase = 'budget'))
              or ((pr.fase_atual = 'actual') and (projeto_requisicoes.fase = 'actual')
                  and (projeto_requisicoes.status = any (array['rascunho','erro']))
                  and (projeto_requisicoes.bloqueado = false))))))
  with check (_is_admin() or (exists ( select 1 from projetos pr
          where pr.id = projeto_requisicoes.projeto_id
            and pr.criado_por = auth.uid()
            and _user_has_perm('projetos.pedidos.create'))));

create policy projeto_requisicoes_delete on public.projeto_requisicoes
  for delete to authenticated
  using (_is_admin() or (exists ( select 1 from projetos pr
          where pr.id = projeto_requisicoes.projeto_id
            and pr.criado_por = auth.uid()
            and _user_has_perm('projetos.pedidos.create')
            and pr.fase_atual = 'budget'
            and projeto_requisicoes.fase = 'budget')));

-- --- projetos: volta ao estado do baseline ---
drop policy if exists projetos_select on public.projetos;
create policy projetos_select on public.projetos
  for select to authenticated
  using (_is_admin() or _user_has_perm('projetos.view_all')
         or (_user_has_perm('projetos.view_own')
             and (criado_por = auth.uid() or aprovador_id = auth.uid())));

drop policy if exists projetos_update on public.projetos;
create policy projetos_update on public.projetos
  for update to authenticated
  using (_is_admin()
         or (_user_has_perm('projetos.edit_own') and criado_por = auth.uid()
             and fase_atual = 'budget')
         or (_user_has_perm('projetos.approve') and aprovador_id = auth.uid()
             and fase_atual = 'budget_em_aprovacao'))
  with check (_is_admin()
         or (_user_has_perm('projetos.edit_own') and criado_por = auth.uid())
         or (_user_has_perm('projetos.approve') and aprovador_id = auth.uid()));

drop policy if exists projetos_delete on public.projetos;
create policy projetos_delete on public.projetos
  for delete to authenticated
  using (_is_admin()
         or (_user_has_perm('projetos.delete_own') and criado_por = auth.uid()
             and fase_atual = 'budget'));

-- --- projeto_eventos: volta a nao ter policy nenhuma ---
drop policy if exists projeto_eventos_select on public.projeto_eventos;

notify pgrst, 'reload schema';
*/
