-- =============================================================================
-- OP-2.3 · Pré-requisitos de banco da Edge Function `sync-reqmat`
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- ⚠ ORDEM DE APLICAÇÃO É CRÍTICA: TODO ESTE SQL PRIMEIRO, DEPLOY DEPOIS.
--   A função nova referencia `codigo_tipo_req_mat` e chama
--   `op_reqmat_aplicar_load`. Sem eles, o passo B falha inteiro (400 no
--   PostgREST / função inexistente) e o CHECK do sync_runs derruba a
--   execução no passo zero. O inverso — SQL aplicado e função ainda
--   antiga — é seguro: colunas novas ficam nulas, RPC fica sem chamador.
--   Mesma lição da REC-3.0.
--
-- CONTEÚDO
--   1. `sync_runs.job_type` estendido com 'reqmat'   ← SEM ISTO NADA RODA
--   2. kill-switch em `sync_settings`
--   3. duas colunas aditivas em `op_reqmat` (+ índice da fila do passo B)
--   4. RPC transacional `op_reqmat_aplicar_load`
--   5. disparador `call_sync_reqmat_cron` + agendamento (BLOCO COMENTADO)
--
-- ⚠ NADA AQUI TOCA EM `op_requisicoes`. Aquela tabela é o livro do Hub e o
--   sync nunca escreve nela.
-- =============================================================================


-- ─── 1. sync_runs.job_type — estender o CHECK ────────────────────────────────
-- 🔴 REGRA PERMANENTE DO REPO (REC-1.2, §9.4): `public.sync_runs.job_type` tem
-- CHECK ENUMERADO e a tabela é compartilhada pelos 8 crons do Hub. Todo sync
-- NOVO precisa estender a constraint ANTES do primeiro disparo — senão a
-- Edge Function morre com `ERROR 23514` ao abrir o registro de execução, sem
-- sequer chamar o ERP.
--
-- Aditivo e EM TRANSAÇÃO: a tabela é gravada por crons ativos; sem begin/commit
-- ela ficaria sem CHECK entre o drop e o add.
--
-- ⚠ O valor 'requisicoes' JÁ EXISTE e é de OUTRO job (Suprimentos). Por isso o
--   nosso é 'reqmat' — reaproveitá-lo misturaria dois módulos no histórico.
begin;

alter table public.sync_runs drop constraint if exists sync_runs_job_type_check;

alter table public.sync_runs add constraint sync_runs_job_type_check
  check (job_type = any (array[
    'requisicoes'::text,      -- Suprimentos (NÃO é este job)
    'pedidos'::text,
    'bicephalous'::text,
    'despesas'::text,
    'docfin_despesas'::text,
    'nfe'::text,
    'intercompany'::text,
    'lote'::text,
    'produtos'::text,
    'laudos'::text,
    'reqmat'::text            -- ← OP-2.3, novo
  ]));

commit;

-- Nota: `sync_runs_triggered_by_check` continua restrito a
-- ('pg_cron','manual_admin','test') — a Edge Function já sanitiza esse valor.


-- ─── 2. Kill-switch ──────────────────────────────────────────────────────────
-- `enabled=false` faz a função registrar "Pausado" em sync_runs e sair SEM
-- tocar no Alvo. Sem esta linha o job roda igual (a função trata ausência como
-- habilitado), mas não haveria como desligá-lo sem redeploy.
insert into public.sync_settings (job_name, enabled)
values ('sync-reqmat', true)
on conflict (job_name) do nothing;


-- ─── 3. Colunas aditivas em op_reqmat ────────────────────────────────────────
-- Duas colunas que a OP-2.2 não previu, ambas medidas em campo em 05/08/2026.
-- Aditivas, nullable, tabela vazia ⇒ risco zero. A OP-2.2 NÃO é alterada.

alter table public.op_reqmat add column if not exists codigo_tipo_req_mat text;
alter table public.op_reqmat add column if not exists numero_ord_produc   text;

comment on column public.op_reqmat.codigo_tipo_req_mat is
  'CodigoTipoReqMat do Alvo. QUATRO valores no universo (n=678, 05/08/2026): 0000002 REQUISIÇÃO PRODUÇÃO (279) · 0000004 SAÍDA CONSUMO · 0000005 (não documentado, candidato a DEVOLUÇÃO, §6.1-3) · NULL (requisição sem tipo). ⚠ NULL é valor real e frequente — nenhum código pode assumir esta coluna não-nula. O ESPELHO NÃO FILTRA (retrato fiel), mas 🔴 O CONSOLIDADO DA OP E A MÉTRICA DE VAZAMENTO DA §10.7 FILTRAM 0000002: somar saída de material de consumo como material de produção infla o "disponibilizado" da OP com material que nunca entrou na produção — erro silencioso.';

comment on column public.op_reqmat.numero_ord_produc is
  'NumeroOrdProduc do Alvo. É campo de CABEÇALHO — retificado em 05/08/2026; a OP-2.2 o havia colocado no item, com base na leitura anterior. Null nos 678 registros do ano, inclusive nas RMs que trazem a OP escrita à mão na Descrição. Espelhado assim mesmo: se um dia for gravável (BL-9), o vínculo OP↔RM pode virar estruturado do lado do ERP e a §10.4 muda.';

-- A coluna homônima do ITEM fica órfã. NÃO é dropada aqui (nada destrutivo sem
-- aprovação); fica marcada para ninguém a consultar por engano.
comment on column public.op_reqmat_itens.numero_ord_produc is
  '⚠ OBSOLETA — SEMPRE NULL. O campo NumeroOrdProduc NÃO EXISTE no item do ReqMat/Load; é de cabeçalho (medido em 05/08/2026). A coluna veio da OP-2.2 por leitura equivocada e o sync NUNCA a preenche. Use op_reqmat.numero_ord_produc. Mantida para não fazer DDL destrutiva; pode ser dropada numa faxina futura.';

-- Índice da fila do passo B. A ordem casa EXATAMENTE com o .order() da função:
--   codigo_tipo_req_mat asc NULLS LAST → detalhes_carregados_em asc NULLS FIRST
--   → data desc
-- ⚠ '0000002' (produção) é o MENOR código entre os quatro tipos observados, então
--   o `asc nulls last` entrega a prioridade pedida SEM expressão CASE — e é
--   justamente isso que mantém o índice utilizável. Se algum dia aparecer um tipo
--   lexicograficamente menor que '0000002', ele passa na frente da produção.
create index if not exists idx_op_reqmat_fila
  on public.op_reqmat (codigo_tipo_req_mat asc nulls last,
                       detalhes_carregados_em asc nulls first,
                       data desc)
  where precisa_releitura;

create index if not exists idx_op_reqmat_tipo
  on public.op_reqmat (codigo_tipo_req_mat);


-- ─── 4. RPC transacional do passo B ──────────────────────────────────────────
-- 🔴 POR QUE ESTA FUNÇÃO EXISTE.
-- Os filhos são substituídos POR INTEIRO a cada Load (delete + insert): item
-- cancelado SOME da resposta do Alvo e um upsert incremental deixaria lixo
-- somando no consolidado da OP. `op_reqmat_lotes` sequer tem chave natural
-- única — não haveria `onConflict` possível.
--
-- Feito em três chamadas PostgREST separadas, existiria uma janela entre o
-- DELETE e o INSERT em que a RM fica SEM FILHOS. O consolidado da OP leria
-- "atendido 0 / tudo em aberto" — numa tela que decide requisição de material,
-- isso é errado do jeito ruim. Aqui tudo roda num único commit: ou o espelho
-- tem os filhos antigos, ou tem os novos, nunca nenhum.
--
-- SEGURANÇA. SECURITY DEFINER + search_path fixo, no padrão do repo. Quem chama
-- é a Edge Function com service_role — NÃO um usuário do app —, então o gate
-- NÃO é `user_has_permission` (auth.uid() seria null e a função nunca rodaria).
-- O gate é o GRANT: revogada de public/anon/authenticated, concedida só a
-- service_role. Mesmo padrão de lockdown de `op_proximo_numero()` (OP-1.2).
--
-- CONTRATO. `p_cabecalho` traz APENAS as chaves que vieram na resposta do Alvo;
-- cada coluna só é tocada se a chave existir (`jsonb_exists`). Isso preserva o
-- que o passo A gravou quando o Load não devolve o campo. Já `p_itens`/`p_lotes`
-- vêm com shape fixo (são INSERT) e as chaves são nomes de coluna.
create or replace function public.op_reqmat_aplicar_load(
  p_filial    text,
  p_numero    text,
  p_cabecalho jsonb,
  p_itens     jsonb,
  p_lotes     jsonb,
  p_raw       jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removidos int := 0;
  v_itens     int := 0;
  v_lotes     int := 0;
  v_status    text;
begin
  -- Cinto e suspensório da guarda que já existe no TypeScript.
  -- NÃO EXISTE RM SEM ITEM: lista vazia é sintoma de `loadChild` ausente ou
  -- degradado, não de requisição sem material. Apagar os filhos com base nisso
  -- esvaziaria uma RM boa.
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception
      'op_reqmat_aplicar_load: p_itens vazio ou nao-array para a RM % / % — nao existe RM sem item; abortado sem tocar no espelho',
      p_filial, p_numero using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.op_reqmat
     where codigo_empresa_filial = p_filial and numero = p_numero
  ) then
    raise exception
      'op_reqmat_aplicar_load: RM % / % nao existe no espelho — o passo A precisa rodar antes',
      p_filial, p_numero using errcode = 'foreign_key_violation';
  end if;

  -- Substituição por inteiro. O CASCADE de op_reqmat_itens leva os lotes junto.
  delete from public.op_reqmat_itens
   where codigo_empresa_filial = p_filial
     and numero_reqmat = p_numero;
  get diagnostics v_removidos = row_count;

  -- Colunas listadas explicitamente: as que têm default (sincronizado_em,
  -- created_at) ficam de fora para o DEFAULT valer. `numero_ord_produc` do item
  -- fica de fora porque é OBSOLETA (o campo é de cabeçalho).
  insert into public.op_reqmat_itens (
    codigo_empresa_filial, numero_reqmat, sequencia,
    codigo_produto, codigo_alternativo_produto, codigo_prod_unid_med,
    posicao_prod_unid_med, codigo_loc_armaz,
    quantidade, quantidade_atendida, quantidade_saldo, quantidade_atendida_maior,
    quantidade_devolvida, quantidade_perdida, quantidade_separada,
    data_atendimento, data_hora_atendimento, codigo_funcionario_atendente,
    gera_pendencia, gera_empenho, baixa_estoque, cancelado, estornado,
    finalizou_op, raw
  )
  select
    codigo_empresa_filial, numero_reqmat, sequencia,
    codigo_produto, codigo_alternativo_produto, codigo_prod_unid_med,
    posicao_prod_unid_med, codigo_loc_armaz,
    quantidade, quantidade_atendida, quantidade_saldo, quantidade_atendida_maior,
    quantidade_devolvida, quantidade_perdida, quantidade_separada,
    data_atendimento, data_hora_atendimento, codigo_funcionario_atendente,
    gera_pendencia, gera_empenho, baixa_estoque, cancelado, estornado,
    finalizou_op, raw
  from jsonb_populate_recordset(null::public.op_reqmat_itens, p_itens);
  get diagnostics v_itens = row_count;

  -- Item não atendido tem ZERO lotes — lista vazia AQUI é normal (provado na
  -- seq 21 da RM 0000002251). Não confundir com a lista de itens.
  if p_lotes is not null and jsonb_typeof(p_lotes) = 'array' and jsonb_array_length(p_lotes) > 0 then
    insert into public.op_reqmat_lotes (
      codigo_empresa_filial, numero_reqmat, sequencia_item,
      codigo_produto, codigo_loc_armaz, numero_ctrl_lote, data_validade_ctrl_lote,
      quantidade, quantidade_bruta, quantidade_unidade_item,
      operacao, codigo_prod_unid_med, posicao_prod_unid_med, raw
    )
    select
      codigo_empresa_filial, numero_reqmat, sequencia_item,
      codigo_produto, codigo_loc_armaz, numero_ctrl_lote, data_validade_ctrl_lote,
      quantidade, quantidade_bruta, quantidade_unidade_item,
      operacao, codigo_prod_unid_med, posicao_prod_unid_med, raw
    from jsonb_populate_recordset(null::public.op_reqmat_lotes, p_lotes);
    get diagnostics v_lotes = row_count;
  end if;

  -- `load_status_lido` guarda o estado que ESTA leitura enxergou — é a metade
  -- da comparação que governa `precisa_releitura`. Se o Load não trouxer
  -- `Status`, cai para o status atual da linha: gravar null criaria releitura
  -- eterna (o `IS DISTINCT FROM` nunca convergiria).
  select coalesce(p_cabecalho->>'status', r.status)
    into v_status
    from public.op_reqmat r
   where r.codigo_empresa_filial = p_filial and r.numero = p_numero;

  update public.op_reqmat set
    data                        = case when jsonb_exists(p_cabecalho,'data')                        then (p_cabecalho->>'data')::timestamptz         else data                        end,
    descricao                   = case when jsonb_exists(p_cabecalho,'descricao')                   then  p_cabecalho->>'descricao'                   else descricao                   end,
    codigo_centro_ctrl          = case when jsonb_exists(p_cabecalho,'codigo_centro_ctrl')          then  p_cabecalho->>'codigo_centro_ctrl'          else codigo_centro_ctrl          end,
    codigo_funcionario          = case when jsonb_exists(p_cabecalho,'codigo_funcionario')          then  p_cabecalho->>'codigo_funcionario'          else codigo_funcionario          end,
    especie_documento           = case when jsonb_exists(p_cabecalho,'especie_documento')           then  p_cabecalho->>'especie_documento'           else especie_documento           end,
    status                      = case when jsonb_exists(p_cabecalho,'status')                      then  p_cabecalho->>'status'                      else status                      end,
    baixou_estoque              = case when jsonb_exists(p_cabecalho,'baixou_estoque')              then  p_cabecalho->>'baixou_estoque'              else baixou_estoque              end,
    codigo_tipo_lanc            = case when jsonb_exists(p_cabecalho,'codigo_tipo_lanc')            then  p_cabecalho->>'codigo_tipo_lanc'            else codigo_tipo_lanc            end,
    data_entrega                = case when jsonb_exists(p_cabecalho,'data_entrega')                then (p_cabecalho->>'data_entrega')::timestamptz else data_entrega                end,
    codigo_funcionario_entregou = case when jsonb_exists(p_cabecalho,'codigo_funcionario_entregou') then  p_cabecalho->>'codigo_funcionario_entregou' else codigo_funcionario_entregou end,
    codigo_funcionario_retirou  = case when jsonb_exists(p_cabecalho,'codigo_funcionario_retirou')  then  p_cabecalho->>'codigo_funcionario_retirou'  else codigo_funcionario_retirou  end,
    codigo_usuario              = case when jsonb_exists(p_cabecalho,'codigo_usuario')              then  p_cabecalho->>'codigo_usuario'              else codigo_usuario              end,
    operacao                    = case when jsonb_exists(p_cabecalho,'operacao')                    then  p_cabecalho->>'operacao'                    else operacao                    end,
    tipo_atendimento            = case when jsonb_exists(p_cabecalho,'tipo_atendimento')            then  p_cabecalho->>'tipo_atendimento'            else tipo_atendimento            end,
    data_validade               = case when jsonb_exists(p_cabecalho,'data_validade')               then (p_cabecalho->>'data_validade')::date       else data_validade               end,
    codigo_loc_armaz            = case when jsonb_exists(p_cabecalho,'codigo_loc_armaz')            then  p_cabecalho->>'codigo_loc_armaz'            else codigo_loc_armaz            end,
    gera_empenho                = case when jsonb_exists(p_cabecalho,'gera_empenho')                then  p_cabecalho->>'gera_empenho'                else gera_empenho                end,
    origem                      = case when jsonb_exists(p_cabecalho,'origem')                      then  p_cabecalho->>'origem'                      else origem                      end,
    codigo_tipo_req_mat         = case when jsonb_exists(p_cabecalho,'codigo_tipo_req_mat')         then  p_cabecalho->>'codigo_tipo_req_mat'         else codigo_tipo_req_mat         end,
    numero_ord_produc           = case when jsonb_exists(p_cabecalho,'numero_ord_produc')           then  p_cabecalho->>'numero_ord_produc'           else numero_ord_produc           end,
    raw                         = coalesce(p_raw, raw),
    load_status_lido            = v_status,
    detalhes_carregados_em      = now()
  where codigo_empresa_filial = p_filial
    and numero = p_numero;

  return jsonb_build_object(
    'itens_removidos',  v_removidos,
    'itens_inseridos',  v_itens,
    'lotes_inseridos',  v_lotes,
    'load_status_lido', v_status
  );
end;
$$;

comment on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) is
  'OP-2.3 · Aplica um ReqMat/Load no espelho NUM ÚNICO COMMIT: apaga os filhos da RM (cascade nos lotes), reinsere itens e lotes, atualiza o cabeçalho apenas nas chaves presentes em p_cabecalho e carimba detalhes_carregados_em + load_status_lido. Existe para eliminar a janela em que a RM ficaria sem filhos entre o DELETE e o INSERT — o consolidado da OP leria "atendido 0" numa tela que decide requisição. Chamada só pela Edge Function sync-reqmat (service_role); revogada de anon e authenticated. NUNCA toca em op_requisicoes.';

-- Lockdown: quem chama é a Edge Function (service_role), nunca o app.
revoke all on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) from anon;
revoke all on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) from authenticated;
grant execute on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) to service_role;


-- =============================================================================
-- 5. AGENDAMENTO — BLOCO COMENTADO DE PROPÓSITO
-- =============================================================================
-- ⚠ NÃO habilitar junto com o resto. A sequência é:
--     (a) aplicar as seções 1–4 acima;
--     (b) `supabase functions deploy sync-reqmat --no-verify-jwt --project-ref hbtggrbauguukewiknew`;
--     (c) UM disparo manual, conferindo `sync_runs` (status distintos, campos da
--         listagem, total_erros, duracao_ms);
--     (d) só então descomentar e aplicar este bloco.
--
-- Motivo: `LOAD_BATCH`/`LOAD_CHUNK` da função foram escolhidos SEM medição do
-- custo do `ReqMat/Load` (o Laudo/Load levava 1–3 s; o MovEstq/Load ~370 ms; o
-- ReqMat traz 22 itens + lotes por RM). O 1º disparo é que dá o número. Agendar
-- antes de medir é convidar um cron que estoura o watchdog quatro vezes ao dia
-- num gateway compartilhado com 100+ usuários de Suprimentos.
--
-- JANELA ESCOLHIDA: minuto 50, dias úteis. Ocupado hoje (UTC): hora cheia
-- (compras, 11–20), minutos 00/10/30 (despesas/docfin/intercompany, às 10/15/19),
-- minuto 45 (sync-laudos, às 11/14/17/20) e */15 (notify-*). O minuto 50 está
-- livre e fica 5 min depois do sync-laudos, sem disputar o gateway com ele.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- -- Disparador (espelha call_sync_laudos_cron; MESMO secret do Vault de todos
-- -- os crons do Hub).
-- create or replace function public.call_sync_reqmat_cron(p_triggered_by text default 'pg_cron')
-- returns bigint
-- language plpgsql
-- security definer
-- set search_path = public, vault, extensions
-- as $fn$
-- declare
--   v_secret       text;
--   v_request_id   bigint;
--   v_url          text := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/sync-reqmat';
--   v_safe_trigger text;
-- begin
--   if p_triggered_by not in ('pg_cron', 'manual_admin', 'test') then
--     v_safe_trigger := 'pg_cron';
--   else
--     v_safe_trigger := p_triggered_by;
--   end if;
--
--   select decrypted_secret into v_secret
--     from vault.decrypted_secrets
--    where name = 'sync_compras_cron_secret'
--    limit 1;
--
--   if v_secret is null then
--     raise exception 'Secret sync_compras_cron_secret nao encontrado no Vault';
--   end if;
--
--   select net.http_post(
--     url     := v_url,
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
--     body    := jsonb_build_object('triggered_by', v_safe_trigger),
--     timeout_milliseconds := 180000
--   ) into v_request_id;
--
--   return v_request_id;
-- end;
-- $fn$;
--
-- revoke all on function public.call_sync_reqmat_cron(text) from public;
-- revoke all on function public.call_sync_reqmat_cron(text) from anon;
-- revoke all on function public.call_sync_reqmat_cron(text) from authenticated;
--
-- -- 08:50 / 11:50 / 14:50 / 17:50 BRT, dias úteis.
-- select cron.schedule(
--   'sync-reqmat-4x-dia',
--   '50 11,14,17,20 * * 1-5',
--   $cron$ select public.call_sync_reqmat_cron('pg_cron'); $cron$
-- );
--
-- -- Disparo manual (acelera a convergência inicial: 678 RMs nunca lidas contra
-- -- LOAD_BATCH=60 ⇒ ~12 execuções para a 1ª volta completa):
-- --   select public.call_sync_reqmat_cron('manual_admin');
-- --
-- -- Desagendar:
-- --   select cron.unschedule('sync-reqmat-4x-dia');
-- ─────────────────────────────────────────────────────────────────────────────


-- =============================================================================
-- VERIFICAÇÃO (rodar DEPOIS de aplicar as seções 1–4)
-- =============================================================================
-- fingerprint do projeto (05/08/2026 ≈ 1796; cresce com o cron de compras)
--   select count(*) as fingerprint from compras_pedidos;
--
-- 1) o CHECK aceita 'reqmat' (esperado: 11 valores, incluindo reqmat)
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.sync_runs'::regclass and conname='sync_runs_job_type_check';
--
-- 2) kill-switch
--   select job_name, enabled from sync_settings where job_name='sync-reqmat';
--
-- 3) colunas novas (esperado: op_reqmat com 30 colunas, era 28)
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='op_reqmat'
--      and column_name in ('codigo_tipo_req_mat','numero_ord_produc');
--   select count(*) as colunas_op_reqmat from information_schema.columns
--    where table_schema='public' and table_name='op_reqmat';
--
-- 4) índices novos (esperado: 8 índices em op_reqmat, eram 6 + PK)
--   select indexname, indexdef from pg_indexes
--    where schemaname='public' and tablename='op_reqmat' order by indexname;
--
-- 5) a RPC existe, é DEFINER, tem search_path e está TRANCADA
--   select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='op_reqmat_aplicar_load';
--   select has_function_privilege('authenticated',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)','execute') as authenticated_pode,
--          has_function_privilege('anon',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)','execute') as anon_pode,
--          has_function_privilege('service_role',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)','execute') as service_role_pode;
--   -- esperado: false, false, true
--
-- 6) espelho ainda vazio antes do 1º disparo
--   select 'op_reqmat' t, count(*) from op_reqmat
--   union all select 'op_reqmat_itens', count(*) from op_reqmat_itens
--   union all select 'op_reqmat_lotes', count(*) from op_reqmat_lotes
--   union all select 'op_requisicoes',  count(*) from op_requisicoes;  -- DEVE seguir 0: o sync não escreve aqui
--
-- DEPOIS DO 1º DISPARO — o que olhar (esta é a tarefa de medição da OP-2.3):
--   select id, started_at, duracao_ms, total_candidatos, total_consultados,
--          total_mudaram, total_erros, observacao
--     from sync_runs where job_type='reqmat' order by started_at desc limit 5;
--   -- e, dentro de `detalhes`, as entradas com:
--   --   "status distintos (listagem)"  → confirma o terminal 'Atendida Total'
--   --   "status distintos (ReqMat/Load)" → divergência com a listagem = releitura eterna
--   --   "tipos de ReqMat (listagem)"   → distribuição dos quatro tipos
--   --   "1ª execução — a listagem devolveu N campos" → contrato da listagem
--   --   "STATUS DESCONHECIDO"          → entra como ERRO, exige revisão da coluna gerada


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- A ordem importa: primeiro desagendar, depois a RPC, por último as colunas.
--
--   select cron.unschedule('sync-reqmat-4x-dia');           -- se tiver agendado
--   drop function if exists public.call_sync_reqmat_cron(text);
--   drop function if exists public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb);
--   drop index if exists public.idx_op_reqmat_fila;
--   drop index if exists public.idx_op_reqmat_tipo;
--   -- ⚠ dropar as colunas só se o espelho estiver descartável: elas carregam dado.
--   --   alter table public.op_reqmat drop column if exists codigo_tipo_req_mat;
--   --   alter table public.op_reqmat drop column if exists numero_ord_produc;
--   delete from public.sync_settings where job_name='sync-reqmat';
--   -- ⚠ NÃO reverter o CHECK de sync_runs enquanto existir linha com
--   --   job_type='reqmat' — o ADD da constraint antiga falharia. Apagar as
--   --   linhas do job primeiro, ou deixar o valor no CHECK (é inofensivo).
-- =============================================================================
