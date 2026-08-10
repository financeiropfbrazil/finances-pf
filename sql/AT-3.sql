-- =============================================================================
-- AT-3 · Atendimento de RM pelo Hub — livro `op_rm_atendimentos` + RPCs do ciclo
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Fase 4 do módulo OP — `PLANO-RM-ATENDIMENTO.md`, tarefa AT-3.
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação empírica e rollback no fim do arquivo.
--
-- ⚠ Nome do arquivo: o plano da fase escrevia `sql/AT-1.sql`; corrigido para
--   `AT-3.sql` em 09/08/2026 (decisão do Pedro — convenção do repo é o número
--   da TAREFA, como `OP-2.2.sql`). Registrado como Ajuste A1 do plano da fase.
--
-- ESCOPO:
--   · 1 coluna nova em `op_reqmat` (`codigo_funcionario_conferiu`)
--   · 1 replace ADITIVO na `op_reqmat_aplicar_load` (uma linha no update)
--   · 1 tabela nova (`op_rm_atendimentos`) + RLS + policy de SELECT
--   · 3 funções novas (`op_rm_atender_iniciar` / `_marcar` / `_concluir`)
--   Nenhum cron, secret, trigger, ou policy de ESCRITA. Não há DML de dados.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA ENTREGA É (decisões de 09/08/2026, sessão com o Pedro)
-- ─────────────────────────────────────────────────────────────────────────────
-- A Fase 4 põe o atendimento de RM no Hub. O ciclo (AT-4) é:
--
--   Load → lotes → Relacionar → RELEITURA → Validar → Finalizar → semear
--
-- Este arquivo é o lado do BANCO desse ciclo: o LIVRO que registra cada
-- tentativa, e o caminho de semeadura que faz a RM atendida aparecer na fila
-- NA HORA (aceite nº 8), sem esperar o sync de 4×/dia.
--
-- 🔴 A LINHA DO LIVRO NASCE ANTES DA RELEITURA, de propósito — e isso FECHA a
--    incógnita §5.2 do plano por INSTRUMENTAÇÃO em vez de teste destrutivo:
--    toda recusa por concorrência (alguém atendeu no Alvo entre a abertura da
--    tela e o envio) vira uma linha `recusado_releitura` no livro, com o diff
--    guardado. Testar dupla finalização de propósito custaria mais uma baixa
--    real em produção (o BL-29 já custou 30 unidades); medir no uso é melhor.
--
-- 🔴 TRAVA Hub-vs-Hub: a releitura protege contra quem atendeu NO ALVO; o
--    índice único parcial `ux_op_rm_atend_em_voo` protege contra NÓS MESMOS —
--    duas abas (ou duas pessoas) atendendo a mesma RM PELO HUB. Não é unique
--    simples de propósito: tentativa abandonada (aba fechada) expira em 15 min
--    e é carimbada `abandonado` pela própria `iniciar`, senão travaria a RM
--    para sempre.
--
-- ⚠ `codigo_funcionario_conferiu` entra no espelho porque Entregou / Retirou /
--   Conferiu é TODA a rastreabilidade real de pessoas do atendimento — o
--   `CodigoFuncionarioAtendente` é falso (vem sempre `0000165`, padrão do
--   local `001`, independentemente de quem atende; §6.3-N do PLANO-OP.md).
--   O espelho já tinha entregou/retirou; faltava conferiu.
--
-- ⚠ `GeraPendencia` fica FIXO em "Sim" na v1 (decisão de 09/08): a semântica
--   do "Não" nunca foi medida — e há o registro de campo do Pedro de que na
--   RM 2272 respondeu-se "Não" e ela permaneceu `Atendida Parcial` COM saldo,
--   ou seja, "Não" NÃO abandona o saldo, mas o que ele faz de fato segue
--   desconhecido. Isso é regra do SERVIÇO (AT-4), não deste arquivo — está
--   aqui para o registro ficar onde o desenho nasceu.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE TRÊS FUNÇÕES, E O MOLDE DELAS
-- ─────────────────────────────────────────────────────────────────────────────
-- Molde: OP-2.7 (`op_rm_criar` / `op_rm_marcar_enviado` / `op_rm_marcar_confirmado`)
-- e OP-2.9 (`op_reqmat_semear_criacao`). Mesmo envelope de retorno
-- (`{success, erro_codigo, mensagem, ...}`), mesma higiene, mesma filosofia:
--
--   `iniciar`  — a linha nasce ANTES de qualquer POST com efeito. Se o browser
--                morrer no meio, existe rastro do que se tentou (§10.14).
--   `marcar`   — carimba os estados intermediários e os desfechos sem
--                semeadura: `validado` (Validar OK), `recusado_releitura`,
--                `erro`. Um `erro` com `validado_em` preenchido é o estado
--                perigoso — Validar passou e o Finalizar não se sabe — o
--                análogo do "Insert OK + Update falho" da criação, visível
--                por construção.
--   `concluir` — SÓ de `validado`, e SÓ da mesma RM: a segunda tranca, no
--                molde da `semear_criacao` (que exige livro em `enviado`).
--                Não é RPC genérica de escrita no espelho — é o passo 7 de UM
--                ciclo de atendimento. Delega itens/lotes/carimbos à
--                `op_reqmat_aplicar_load`, preservando a transação única que
--                fecha a janela do "atendido 0".
--
-- ⚠ A delegação atravessa o revoke da `aplicar_load` pelo MESMO mecanismo já
--   provado na OP-2.9 (§10.28): `op_rm_atender_concluir` é SECURITY DEFINER
--   com owner `postgres`, que é o dono da função de destino. `anon` e
--   `authenticated` continuam sem alcançá-la diretamente.
--
-- ⚠ Se a semeadura falhar com o Finalizar OK, o livro carimba `finalizado`
--   MESMO ASSIM (com o motivo em `erro_mensagem`): o ERP é a verdade, o
--   espelho ficou para trás, e o sync conserta em ≤3 h. É o MESMO julgamento
--   da criação (`reqMatEspelhoService` / OP-2.9) — o livro nunca mente sobre
--   o que aconteceu no Alvo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 REGRA DO PROJETO: `revoke ... from public` NÃO tranca RPC nova
-- ─────────────────────────────────────────────────────────────────────────────
-- Lida em `pg_default_acl` (08/08/2026): toda função nova em `public` nasce com
-- EXECUTE concedido NOMINALMENTE a `anon` (default privilege do Supabase), e
-- `revoke from public` não alcança grant nominal. ⇒ O bloco de grants abaixo
-- revoga de `anon` POR NOME, com a assinatura completa, DEPOIS dos creates.
-- Detalhe completo no cabeçalho da OP-2.9.
--
-- CONTRATO DE RETORNO (o mesmo das RPCs da OP-2.7/2.9):
--   sucesso → { "success": true,  ... }
--   falha   → { "success": false, "erro_codigo": "...", "mensagem": "..." }
--
-- Códigos: sem_permissao · sem_sessao · sem_numero · nao_no_espelho ·
--          rm_ausente · rm_ja_atendida · atendimento_em_voo · nao_encontrado ·
--          status_invalido · transicao_invalida · rm_divergente · sem_itens
-- =============================================================================


-- =============================================================================
-- 0) PRÉ-VOO (protocolo de sessão — rodar ANTES de aplicar, colar o resultado)
-- =============================================================================
--   select count(*) from public.compras_pedidos;
--   -- era 1820 em 08/08/2026; cresce com o cron de compras — esperado ≥ 1820.


-- =============================================================================
-- 1) ESPELHO · coluna `codigo_funcionario_conferiu` no cabeçalho
-- =============================================================================
-- Aditiva. O sync só passa a preenchê-la quando o `reqmatMapper.ts` ganhar a
-- chave `codigo_funcionario_conferiu` (commit do AT-4) e a Edge `sync-reqmat`
-- for redeployada — até lá a coluna fica como o Hub a semear, sem quebrar nada:
-- a `aplicar_load` só toca coluna cuja chave exista no payload (`jsonb_exists`).

alter table public.op_reqmat
  add column if not exists codigo_funcionario_conferiu text;

comment on column public.op_reqmat.codigo_funcionario_conferiu is
  'CodigoFuncionarioConferiu do cabeçalho do ReqMat. Com entregou e retirou, é TODA a rastreabilidade real de pessoas do atendimento: o CodigoFuncionarioAtendente é falso (sempre 0000165, padrão do local 001 — §6.3-N). Editável no Alvo e provadamente grava (§10.20). Preenchido pelo Hub no atendimento (Fase 4, AT-3) e pelo sync após o mapper ganhar a chave (AT-4).';


-- =============================================================================
-- 2) `op_reqmat_aplicar_load` — replace ADITIVO (uma linha no update)
-- =============================================================================
-- Corpo IDÊNTICO ao de `sql/OP-2.3.sql`, com EXATAMENTE uma adição: o case de
-- `codigo_funcionario_conferiu` no update do cabeçalho (logo após `retirou`).
-- ⚠ `create or replace` sobre função existente PRESERVA o ACL (medido em
--   08/08/2026) — o lockdown service_role-only continua de pé; reafirmado ao
--   final por higiene.

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
    codigo_funcionario_conferiu = case when jsonb_exists(p_cabecalho,'codigo_funcionario_conferiu') then  p_cabecalho->>'codigo_funcionario_conferiu' else codigo_funcionario_conferiu end,
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
  'OP-2.3 (+AT-3) · Aplica um ReqMat/Load no espelho NUM ÚNICO COMMIT: apaga os filhos da RM (cascade nos lotes), reinsere itens e lotes, atualiza o cabeçalho apenas nas chaves presentes em p_cabecalho e carimba detalhes_carregados_em + load_status_lido. Existe para eliminar a janela em que a RM ficaria sem filhos entre o DELETE e o INSERT — o consolidado da OP leria "atendido 0" numa tela que decide requisição. AT-3 acrescentou codigo_funcionario_conferiu ao update (aditivo, guardado por jsonb_exists). Chamada pela Edge sync-reqmat (service_role) e, por delegação DEFINER→owner (§10.28), pelas RPCs op_reqmat_semear_criacao (OP-2.9) e op_rm_atender_concluir (AT-3); revogada de anon e authenticated. NUNCA toca em op_requisicoes nem em op_rm_atendimentos.';

-- Lockdown reafirmado (o replace preserva o ACL; isto é higiene, não conserto).
revoke all on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) from anon;
revoke all on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) from authenticated;
grant execute on function public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb) to service_role;


-- =============================================================================
-- 3) LIVRO · `op_rm_atendimentos` — uma linha por TENTATIVA de atendimento
-- =============================================================================
-- ⚠ O SYNC NUNCA ESCREVE AQUI. Escrita só pelas três RPCs deste arquivo.

create table if not exists public.op_rm_atendimentos (
  id                    uuid        primary key default gen_random_uuid(),

  codigo_empresa_filial text        not null default '1.01',
  numero_reqmat         text        not null,   -- a RM JÁ existe no espelho (a fila a mostrou). NÃO é FK — padrão do repo (op_requisicoes).

  status                text        not null default 'pendente'
    constraint op_rm_atendimentos_status_check
    check (status in ('pendente','validado','finalizado','erro','recusado_releitura','abandonado')),

  criado_por            uuid        not null,   -- = auth.uid(); uuid puro, sem FK (padrão do repo)
  criado_em             timestamptz not null default now(),
  validado_em           timestamptz,            -- carimbo do Validar OK
  desfecho_em           timestamptz,            -- carimbo de QUALQUER estado terminal

  payload_enviado       jsonb,                  -- o objeto que vai ao Validar — a cópia do pedido
  releitura             jsonb,                  -- o que o passo 4 viu (diff quando recusa) — a métrica da §5.2
  resposta_alvo         jsonb,                  -- resposta crua do Finalizar (ou do Validar, no erro)
  erro_mensagem         text
);

comment on table public.op_rm_atendimentos is
  'LIVRO DO HUB: uma linha por TENTATIVA de atendimento de RM pelo Hub (Fase 4). A linha nasce ANTES da releitura obrigatória — recusas por concorrência ficam registradas (recusado_releitura + diff em `releitura`), o que fecha a §5.2 do plano por instrumentação. O sync NUNCA escreve aqui. Escrita só pelas RPCs op_rm_atender_iniciar/_marcar/_concluir (SECURITY DEFINER, gate producao.rm.atender).';
comment on column public.op_rm_atendimentos.status is
  'pendente = tentativa aberta, nenhum POST com efeito saiu · validado = ValidarAtendimento OK (objeto carimbado em mãos) · finalizado = FinalizarAtendimento OK (com ou sem semeadura — ver erro_mensagem) · erro = Validar ou Finalizar falhou (⚠ erro COM validado_em preenchido = Validar passou e o Finalizar não se sabe — o estado perigoso, análogo ao "Insert OK + Update falho" da criação) · recusado_releitura = a RM mudou no ERP entre a abertura e o envio; nada foi enviado · abandonado = expirada por nova tentativa após 15 min sem desfecho. Texto + CHECK, não enum (padrão do repo).';
comment on column public.op_rm_atendimentos.numero_reqmat is
  'Chave natural da RM no Alvo. Sem FK para op_reqmat DE PROPÓSITO (padrão do livro da criação): o join é por (codigo_empresa_filial, numero_reqmat), e o livro sobrevive a qualquer futuro expurgo do espelho.';
comment on column public.op_rm_atendimentos.payload_enviado is
  'O objeto ReqMat montado pela tela (Load de abertura + Relacionar + ajustes do usuário) — o que foi ou seria mandado ao Validar. Numa recusa de releitura, é a prova do que NÃO foi enviado.';
comment on column public.op_rm_atendimentos.releitura is
  'O que o passo 4 (Load imediatamente antes do envio) enxergou. Na recusa, guarda o diff por item — é a instrumentação que substitui o teste destrutivo da §5.2.';

create index if not exists idx_op_rm_atend_reqmat     on public.op_rm_atendimentos (codigo_empresa_filial, numero_reqmat);
create index if not exists idx_op_rm_atend_status     on public.op_rm_atendimentos (status);
create index if not exists idx_op_rm_atend_criado_por on public.op_rm_atendimentos (criado_por);

-- 🔴 A trava Hub-vs-Hub. ÚNICO e PARCIAL: no máximo UMA tentativa em voo por
--    RM. A corrida real entre duas abas (as duas passam pelo pré-check da
--    `iniciar` no mesmo instante) morre AQUI, no banco — a segunda leva
--    unique_violation, que a `iniciar` traduz em `atendimento_em_voo`.
--    O destravamento é o expurgo de 15 min dentro da própria `iniciar`.
create unique index if not exists ux_op_rm_atend_em_voo
  on public.op_rm_atendimentos (codigo_empresa_filial, numero_reqmat)
  where status in ('pendente','validado');

-- ─── RLS: SELECT no padrão da família (OP-2.4) — sem policy de escrita ───────
-- O drop+create roda dentro da transação de propósito: RLS habilitada SEM
-- policy é deny-all, e sem begin/commit haveria uma janela em que a tela
-- leria vazio. Mesmo cuidado da OP-2.4.
begin;

alter table public.op_rm_atendimentos enable row level security;

drop policy if exists op_rm_atendimentos_select on public.op_rm_atendimentos;
create policy op_rm_atendimentos_select on public.op_rm_atendimentos
  for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'producao.access'))
    or (select public.user_has_permission(auth.uid(), 'producao.rm.access'))
  );

commit;


-- =============================================================================
-- 4) `op_rm_atender_iniciar` — a linha nasce ANTES da releitura
-- =============================================================================
create or replace function public.op_rm_atender_iniciar(
  p_numero  text,
  p_payload jsonb default null,
  p_filial  text  default '1.01'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid         uuid := auth.uid();
  v_numero      text := nullif(trim(coalesce(p_numero, '')), '');
  v_rm          record;
  v_em_voo      record;
  v_id          uuid;
  v_abandonadas int := 0;
begin
  if not public._user_has_perm('producao.rm.atender') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para atender Requisição de Material (producao.rm.atender).');
  end if;
  if v_uid is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_sessao',
      'mensagem', 'Sessão sem auth.uid() — faça login novamente.');
  end if;
  if v_numero is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_numero',
      'mensagem', 'Número da RM não informado.');
  end if;

  -- Validação nº 7 do plano (§3/AT-4), também do lado do banco — cinto e
  -- suspensório: a RM existe no espelho, não está ausente e não está fechada.
  select r.status, r.ausente_desde into v_rm
    from public.op_reqmat r
   where r.codigo_empresa_filial = p_filial
     and r.numero = v_numero;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_no_espelho',
      'mensagem', format('A RM %s não está no espelho do Hub — sincronize antes de atender.', v_numero));
  end if;

  if v_rm.ausente_desde is not null then
    return jsonb_build_object('success', false, 'erro_codigo', 'rm_ausente',
      'mensagem', format('A RM %s está marcada como ausente do ERP desde %s — nada a atender.',
                         v_numero, to_char(v_rm.ausente_desde, 'DD/MM/YYYY')));
  end if;

  if coalesce(v_rm.status, '') = 'Atendida Total' then
    return jsonb_build_object('success', false, 'erro_codigo', 'rm_ja_atendida',
      'mensagem', format('A RM %s já está Atendida Total — nada a atender.', v_numero));
  end if;

  -- Expurgo: tentativa em voo com mais de 15 min é considerada abandonada
  -- (aba fechada, browser morto). SEM isto, o índice único parcial travaria a
  -- RM para sempre. ⚠ Um `validado` abandonado NÃO perde o sinal de perigo:
  -- `validado_em` fica preenchido, e a releitura da nova tentativa enxerga a
  -- verdade atual do ERP antes de qualquer envio.
  update public.op_rm_atendimentos
     set status        = 'abandonado',
         desfecho_em   = now(),
         erro_mensagem = coalesce(erro_mensagem,
           'Abandonada: nova tentativa iniciada após 15 min sem desfecho.')
   where codigo_empresa_filial = p_filial
     and numero_reqmat = v_numero
     and status in ('pendente', 'validado')
     and criado_em < now() - interval '15 minutes';
  get diagnostics v_abandonadas = row_count;

  -- Pré-check para a mensagem amigável (a garantia dura é o índice único).
  select a.id, a.status, a.criado_em into v_em_voo
    from public.op_rm_atendimentos a
   where a.codigo_empresa_filial = p_filial
     and a.numero_reqmat = v_numero
     and a.status in ('pendente', 'validado')
   order by a.criado_em desc
   limit 1;

  if found then
    return jsonb_build_object('success', false, 'erro_codigo', 'atendimento_em_voo',
      'mensagem', format('Já existe um atendimento em andamento desta RM (iniciado há %s min). Aguarde o desfecho ou tente novamente em alguns minutos.',
                         greatest(0, floor(extract(epoch from (now() - v_em_voo.criado_em)) / 60))::int),
      'em_voo_id', v_em_voo.id, 'em_voo_status', v_em_voo.status);
  end if;

  begin
    insert into public.op_rm_atendimentos
      (codigo_empresa_filial, numero_reqmat, status, criado_por, payload_enviado)
    values
      (p_filial, v_numero, 'pendente', v_uid, p_payload)
    returning id into v_id;
  exception when unique_violation then
    -- A corrida real: duas abas passaram pelo pré-check no mesmo instante.
    -- O índice `ux_op_rm_atend_em_voo` barrou a segunda — é para isso que
    -- ele existe.
    return jsonb_build_object('success', false, 'erro_codigo', 'atendimento_em_voo',
      'mensagem', 'Outro atendimento desta RM acabou de ser iniciado. Aguarde o desfecho.');
  end;

  return jsonb_build_object('success', true, 'id', v_id, 'abandonadas', v_abandonadas);
end $function$;

comment on function public.op_rm_atender_iniciar(text, jsonb, text) is
  'AT-3 · Abre uma tentativa de atendimento (linha ''pendente'' no livro) ANTES da releitura e de qualquer POST com efeito. Gate producao.rm.atender. Recusa RM fora do espelho, ausente ou Atendida Total (validação 7 do plano). Trava Hub-vs-Hub: no máximo uma tentativa em voo por RM (índice único parcial), com expurgo de 15 min para tentativa abandonada.';


-- =============================================================================
-- 5) `op_rm_atender_marcar` — carimbos intermediários e desfechos SEM semeadura
-- =============================================================================
-- O status é EXPLÍCITO no parâmetro (diferente da `op_rm_marcar_enviado`, que
-- decide pelo número): aqui os três destinos têm semânticas que não se deduzem
-- de conteúdo — `validado` vem de um Validar OK, `recusado_releitura` de um
-- diff no passo 4, `erro` de falha em qualquer POST.
--   · `finalizado`  → SÓ pela `concluir` (é ela que semeia).
--   · `abandonado`  → SÓ pelo expurgo da `iniciar`.
create or replace function public.op_rm_atender_marcar(
  p_id        uuid,
  p_status    text,
  p_resposta  jsonb default null,
  p_erro      text  default null,
  p_releitura jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_atual record;
begin
  if not public._user_has_perm('producao.rm.atender') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para registrar o atendimento (producao.rm.atender).');
  end if;

  if p_status not in ('validado', 'recusado_releitura', 'erro') then
    return jsonb_build_object('success', false, 'erro_codigo', 'status_invalido',
      'mensagem', format('Status "%s" não é registrável por esta função — só validado, recusado_releitura ou erro.', p_status));
  end if;

  select id, status, validado_em into v_atual
    from public.op_rm_atendimentos where id = p_id;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrado',
      'mensagem', 'Tentativa de atendimento não encontrada no livro do Hub.');
  end if;

  -- Estado terminal não se reabre (filosofia da op_rm_marcar_enviado): um retry
  -- atrasado não pode reescrever o desfecho de uma tentativa já encerrada.
  if v_atual.status in ('finalizado', 'erro', 'recusado_releitura', 'abandonado') then
    return jsonb_build_object('success', false, 'erro_codigo', 'transicao_invalida',
      'mensagem', format('Esta tentativa já está encerrada em "%s" — nada a registrar.', v_atual.status));
  end if;

  if p_status = 'validado' then
    if v_atual.status <> 'pendente' then
      return jsonb_build_object('success', false, 'erro_codigo', 'transicao_invalida',
        'mensagem', format('Só se valida tentativa em "pendente" — esta está em "%s".', v_atual.status));
    end if;
    update public.op_rm_atendimentos
       set status        = 'validado',
           validado_em   = now(),
           resposta_alvo = coalesce(p_resposta, resposta_alvo)
     where id = p_id;
    return jsonb_build_object('success', true, 'status', 'validado');
  end if;

  if p_status = 'recusado_releitura' then
    -- A releitura acontece ANTES do Validar: recusa só sai de `pendente`.
    if v_atual.status <> 'pendente' then
      return jsonb_build_object('success', false, 'erro_codigo', 'transicao_invalida',
        'mensagem', format('Recusa de releitura só de tentativa em "pendente" — esta está em "%s".', v_atual.status));
    end if;
    update public.op_rm_atendimentos
       set status        = 'recusado_releitura',
           desfecho_em   = now(),
           releitura     = coalesce(p_releitura, releitura),
           erro_mensagem = coalesce(p_erro,
             'Releitura recusou: a RM mudou no ERP entre a abertura da tela e o envio.')
     where id = p_id;
    return jsonb_build_object('success', true, 'status', 'recusado_releitura');
  end if;

  -- p_status = 'erro' — de `pendente` (Validar falhou) ou de `validado`
  -- (Finalizar falhou ou não confirmou). ⚠ O segundo caso fica DISTINGUÍVEL
  -- pelo `validado_em` preenchido: é o estado perigoso, e precisa ficar visível.
  update public.op_rm_atendimentos
     set status        = 'erro',
         desfecho_em   = now(),
         resposta_alvo = coalesce(p_resposta, resposta_alvo),
         releitura     = coalesce(p_releitura, releitura),
         erro_mensagem = coalesce(p_erro, 'Falha no atendimento, sem mensagem do ERP.')
   where id = p_id;

  return jsonb_build_object('success', true, 'status', 'erro',
    'apos_validar', v_atual.validado_em is not null or v_atual.status = 'validado');
end $function$;

comment on function public.op_rm_atender_marcar(uuid, text, jsonb, text, jsonb) is
  'AT-3 · Carimba estados intermediários e desfechos SEM semeadura: validado (Validar OK, só de pendente), recusado_releitura (diff no passo 4, só de pendente, com o diff guardado — a métrica da §5.2), erro (de pendente ou validado; erro após validado = o estado perigoso análogo ao "Insert OK + Update falho", distinguível por validado_em preenchido). Estado terminal não se reabre. finalizado só pela _concluir; abandonado só pelo expurgo da _iniciar.';


-- =============================================================================
-- 6) `op_rm_atender_concluir` — Finalizar OK → semear o espelho NA HORA
-- =============================================================================
-- A segunda tranca, no molde da `op_reqmat_semear_criacao`: só conclui quem
-- tem uma tentativa `validado` DAQUELA RM — não é RPC genérica de escrita no
-- espelho, é o passo 7 de UM ciclo. Os blocos (p_cabecalho/p_itens/p_lotes/
-- p_raw) vêm do `montarBlocosDoLoad` sobre um `ReqMat/Load` DE CONFIRMAÇÃO,
-- nunca do payload que o Hub montou — mesma disciplina e mesma razão dura da
-- criação (o Alvo renumera sequência; semear do payload gravaria PK errada).
create or replace function public.op_rm_atender_concluir(
  p_id        uuid,
  p_numero    text,
  p_cabecalho jsonb,
  p_itens     jsonb,
  p_lotes     jsonb,
  p_raw       jsonb,
  p_resposta  jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_numero   text := nullif(trim(coalesce(p_numero, '')), '');
  v_atual    record;
  v_aplicado jsonb;
begin
  if not public._user_has_perm('producao.rm.atender') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para concluir o atendimento (producao.rm.atender).');
  end if;
  if v_uid is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_sessao',
      'mensagem', 'Sessão sem auth.uid() — faça login novamente.');
  end if;
  if v_numero is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_numero',
      'mensagem', 'Número da RM não informado.');
  end if;

  select id, status, codigo_empresa_filial, numero_reqmat into v_atual
    from public.op_rm_atendimentos where id = p_id;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrado',
      'mensagem', 'Tentativa de atendimento não encontrada no livro do Hub.');
  end if;

  if v_atual.status <> 'validado' then
    return jsonb_build_object('success', false, 'erro_codigo', 'transicao_invalida',
      'mensagem', format('Só se conclui tentativa em "validado" — esta está em "%s".', v_atual.status));
  end if;

  -- Amarra a chamada à MESMA RM da tentativa: impede concluir o id de uma RM
  -- com o corpo de outra (por engano ou pelo console).
  if v_atual.numero_reqmat <> v_numero then
    return jsonb_build_object('success', false, 'erro_codigo', 'rm_divergente',
      'mensagem', format('Esta tentativa é da RM %s; recebido corpo da RM %s — nada gravado.',
                         v_atual.numero_reqmat, v_numero));
  end if;

  -- Guarda espelhada da aplicar_load (cinto e suspensório): NÃO EXISTE RM SEM
  -- ITEM — lista vazia aqui é Load degradado, não RM vazia.
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_itens',
      'mensagem', format('A RM %s veio sem itens do ERP — espelho não tocado. O sync atualiza em até 3h.', v_numero));
  end if;

  if not exists (
    select 1 from public.op_reqmat
     where codigo_empresa_filial = v_atual.codigo_empresa_filial
       and numero = v_numero
  ) then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_no_espelho',
      'mensagem', format('A RM %s não está no espelho — nada a atualizar. O sync a traz na próxima passada.', v_numero));
  end if;

  -- ── Filhos + cabeçalho + carimbos, NUM ÚNICO COMMIT ──
  -- A chamada passa porque somos DEFINER com owner `postgres`, dono da função
  -- de destino (mecanismo provado no §10.28 / OP-2.9). O revoke dela continua
  -- de pé para anon e authenticated.
  --
  -- ⚠ Se a semeadura falhar, o livro carimba `finalizado` MESMO ASSIM: o
  --   Finalizar já aconteceu no ERP, e o livro não mente sobre o Alvo. O
  --   espelho fica para trás e o sync conserta em ≤3h — mesmo julgamento da
  --   criação (OP-2.9). O exception rola de volta só o savepoint do bloco:
  --   o update abaixo dele grava normalmente.
  begin
    v_aplicado := public.op_reqmat_aplicar_load(
      v_atual.codigo_empresa_filial, v_numero,
      coalesce(p_cabecalho, '{}'::jsonb), p_itens, p_lotes, p_raw
    );
  exception when others then
    update public.op_rm_atendimentos
       set status        = 'finalizado',
           desfecho_em   = now(),
           resposta_alvo = coalesce(p_resposta, resposta_alvo),
           erro_mensagem = 'Atendimento finalizado no ERP; a semeadura do espelho falhou: '
                           || sqlerrm || ' — o sync corrige em até 3h.'
     where id = p_id;
    return jsonb_build_object('success', true, 'semeado', false,
      'mensagem', 'Atendimento concluído no ERP. O espelho não pôde ser atualizado agora e será corrigido pelo sync.');
  end;

  update public.op_rm_atendimentos
     set status        = 'finalizado',
         desfecho_em   = now(),
         resposta_alvo = coalesce(p_resposta, resposta_alvo),
         erro_mensagem = null
   where id = p_id;

  return jsonb_build_object(
    'success',          true,
    'semeado',          true,
    'numero',           v_numero,
    'itens_inseridos',  coalesce((v_aplicado->>'itens_inseridos')::int, 0),
    'lotes_inseridos',  coalesce((v_aplicado->>'lotes_inseridos')::int, 0),
    'load_status_lido', v_aplicado->>'load_status_lido'
  );
end $function$;

comment on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'AT-3 · Fecha o ciclo: exige tentativa ''validado'' DA MESMA RM (a segunda tranca, molde da semear_criacao), delega itens/lotes/carimbos à op_reqmat_aplicar_load (DEFINER→owner, §10.28) para a RM atendida aparecer NA HORA (aceite 8), e carimba ''finalizado''. Blocos vêm de um ReqMat/Load de confirmação via montarBlocosDoLoad — nunca do payload do Hub. Se a semeadura falhar com o Finalizar OK, carimba finalizado com o motivo: o livro não mente sobre o ERP, e o sync conserta o espelho.';


-- =============================================================================
-- 7) GRANTS — `authenticated` sim, `anon` NÃO (assinatura completa, POR NOME)
-- =============================================================================
-- ⚠ O `revoke from anon` é OBRIGATÓRIO e não é redundante (pg_default_acl —
--   ver cabeçalho). `from public` fica junto por higiene. E vem DEPOIS dos
--   creates: na criação, o default privilege entra primeiro.
revoke execute on function public.op_rm_atender_iniciar(text, jsonb, text)                          from public;
revoke execute on function public.op_rm_atender_iniciar(text, jsonb, text)                          from anon;
grant  execute on function public.op_rm_atender_iniciar(text, jsonb, text)                          to authenticated;

revoke execute on function public.op_rm_atender_marcar(uuid, text, jsonb, text, jsonb)              from public;
revoke execute on function public.op_rm_atender_marcar(uuid, text, jsonb, text, jsonb)              from anon;
grant  execute on function public.op_rm_atender_marcar(uuid, text, jsonb, text, jsonb)              to authenticated;

revoke execute on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke execute on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) from anon;
grant  execute on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;


-- =============================================================================
-- 8) PostgREST — recarregar o cache de schema
-- =============================================================================
-- Sem isto, `supabase.rpc('op_rm_atender_iniciar', …)` responde 404 até o
-- próximo reload.
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar — colar tudo)
-- =============================================================================
-- a) As três funções existem, são DEFINER, com search_path, owner postgres, e
--    `anon` NÃO chama nenhuma:
--
--   select proname, prosecdef as security_definer, proconfig as search_path,
--          pg_get_userbyid(proowner) as owner,
--          has_function_privilege('anon',          oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('op_rm_atender_iniciar','op_rm_atender_marcar','op_rm_atender_concluir')
--    order by proname;
--
--   Esperado: 3 linhas · security_definer = t · owner = postgres ·
--   anon = FALSE · auth = TRUE.
--   🔴 Se `anon` vier TRUE em qualquer uma, a seção 7 não rodou — é o defeito
--      da OP-2.7 se repetindo. Rode a 7 sozinha e confira de novo.
--
-- b) O ACL da `aplicar_load` continua o de antes (replace preserva) e a
--    delegação continua possível:
--
--   select has_function_privilege('postgres',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)', 'execute') as postgres_ok,
--          has_function_privilege('authenticated',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)', 'execute') as auth_bloqueado;
--
--   Esperado: postgres_ok = t · auth_bloqueado = f.
--
-- c) Tabela com RLS ligada e UMA policy, de SELECT, com as duas permissões:
--
--   select c.relrowsecurity as rls,
--          p.polname, p.polcmd,
--          pg_get_expr(p.polqual, p.polrelid) as predicado
--     from pg_class c
--     left join pg_policy p on p.polrelid = c.oid
--    where c.relname = 'op_rm_atendimentos';
--
--   Esperado: rls = t · 1 policy `op_rm_atendimentos_select` · polcmd = r ·
--   predicado citando producao.access E producao.rm.access.
--
-- d) A coluna nova e o índice único parcial:
--
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'op_reqmat'
--      and column_name = 'codigo_funcionario_conferiu';
--
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public' and indexname = 'ux_op_rm_atend_em_voo';
--
--   Esperado: 1 linha em cada; o indexdef com UNIQUE e o WHERE dos dois status.
--
-- e) O gate dispara (smoke NEGATIVO — o Editor roda sem auth.uid()):
--
--   select public.op_rm_atender_iniciar('0000000000');
--
--   Esperado: {"success": false, "erro_codigo": "sem_permissao", ...}.
--   ⚠ Se vier exceção em vez de envelope, me traga o texto — significaria que
--     a `_user_has_perm` não tolera uid nulo, o que contrariaria o
--     comportamento provado das op_rm_* da OP-2.7.
--
-- f) Fingerprint do protocolo (se ainda não colado nesta sessão):
--
--   select count(*) from public.compras_pedidos;   -- esperado ≥ 1820


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Reverte 100% do arquivo. ⚠ A ORDEM IMPORTA: a coluna só pode cair DEPOIS de
-- a `aplicar_load` voltar à definição da OP-2.3 — senão TODO sync e TODA
-- semeadura quebram em runtime (a função referenciaria coluna inexistente).
-- Nada do que as RPCs gravaram é desfeito (livro e espelho ficam como estão;
-- o sync segue mantendo o espelho).
--
--   -- 1. As três RPCs (o atendimento pelo Hub deixa de existir; o Alvo segue)
--   drop function if exists public.op_rm_atender_iniciar(text, jsonb, text);
--   drop function if exists public.op_rm_atender_marcar(uuid, text, jsonb, text, jsonb);
--   drop function if exists public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb);
--   notify pgrst, 'reload schema';
--
--   -- 2. Policy + tabela do livro (⚠ apaga o histórico de tentativas)
--   drop policy if exists op_rm_atendimentos_select on public.op_rm_atendimentos;
--   drop table if exists public.op_rm_atendimentos;
--
--   -- 3. `aplicar_load` de volta à OP-2.3: reaplicar o
--   --    `create or replace function public.op_reqmat_aplicar_load(...)`
--   --    EXATAMENTE como está em `sql/OP-2.3.sql` (o replace preserva o ACL).
--
--   -- 4. Só ENTÃO a coluna:
--   alter table public.op_reqmat drop column if exists codigo_funcionario_conferiu;
