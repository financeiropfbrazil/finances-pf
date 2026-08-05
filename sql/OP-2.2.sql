-- =============================================================================
-- OP-2.2 · Espelho da Requisição de Material + livro de vínculo OP↔RM
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- FONTE (Alvo ERP, entidade ReqMat):
--   POST reqMat/GetListForComponents          → cabeçalhos por período (sem itens)
--   GET  ReqMat/Load?numero=N&loadChild=All   → cabeçalho (103 campos) + itens (102)
--                                               + CtrlLoteItemReqMatChildList
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE DUAS FAMÍLIAS DE TABELA
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) O ESPELHO (op_reqmat / _itens / _lotes) é RETRATO DO ALVO. O Alvo é dono do
--    dado; o sync SOBRESCREVE estas tabelas a cada leitura. Nenhuma coluna é
--    editada por tela. Núcleo tipado + `raw` jsonb — NÃO espelhamos 102 colunas.
--
-- 2) O LIVRO (op_requisicoes) é CONHECIMENTO DO HUB. A Ordem de Produção existe
--    SÓ no Hub: o Alvo não tem OP (`OrdProduc` vazio em 46 requisições + 3 Loads,
--    §6.1-2; `NumeroOrdProduc` null em 22/22 na RM 0000002251, §10.4).
--    O vínculo OP↔RM é gravado na CRIAÇÃO e o sync NUNCA escreve aqui.
--
--    Guardar o vínculo como coluna do espelho seria errado por duas razões:
--      (a) morreria no primeiro upsert desatento do sync;
--      (b) entre o POST no Alvo e o primeiro sync NÃO EXISTE linha no espelho
--          onde gravá-lo — a RM ainda não foi lida.
--
-- ⚠ REGRA PERMANENTE: o sync (OP-2.3) escreve em op_reqmat, op_reqmat_itens e
--   op_reqmat_lotes. O sync NÃO TOCA em op_requisicoes.
--
-- ⚠ Os filhos (itens/lotes) são substituídos por inteiro a cada Load: o sync
--   apaga os filhos daquela RM e reinsere. Item cancelado some da resposta, e um
--   upsert incremental deixaria lixo. Daí o ON DELETE CASCADE.
-- =============================================================================


-- ─── 1. ESPELHO · CABEÇALHO ──────────────────────────────────────────────────
create table if not exists public.op_reqmat (
  -- chave natural (Alvo)
  codigo_empresa_filial        text        not null default '1.01',
  numero                       text        not null,          -- '0000002251'

  -- ── núcleo do cabeçalho (espécime real 0000002251) ──
  data                         timestamptz,
  descricao                    text,                          -- carregador do nº da OP (≤ 40 chars)
  codigo_centro_ctrl           text,                          -- ⚠ derivado do funcionário, não do envio
  codigo_funcionario           text,
  especie_documento            text,
  status                       text,                          -- Aberta | Atendida Parcial | ...
  baixou_estoque               text,                          -- 'Sim' | 'Não' (texto no Alvo)
  codigo_tipo_lanc             text,
  data_entrega                 timestamptz,
  codigo_funcionario_entregou  text,
  codigo_funcionario_retirou   text,
  codigo_usuario               text,
  operacao                     text,                          -- 'Retirada' no cabeçalho
  tipo_atendimento             text,                          -- 'Manual' | 'Automático'
  data_validade                date,
  codigo_loc_armaz             text,
  gera_empenho                 text,
  origem                       text,                          -- 'Importação' (API) | 'ManualAlvo' (tela)

  -- ── controle do espelho ──
  sincronizado_em              timestamptz not null default now(),
  detalhes_carregados_em       timestamptz,                   -- null = ReqMat/Load ainda não rodou
  load_status_lido             text,                          -- status do cabeçalho NAQUELE Load
  ausente_desde                timestamptz,                   -- sumiu da listagem (não apagar a linha)
  precisa_releitura            boolean generated always as (
    ausente_desde is null
    and (
         detalhes_carregados_em is null              -- nunca lida
      or status is null                              -- null-safety do NOT IN abaixo
      or status not in ('Atendida Total')            -- ainda pode mudar
      or status is distinct from load_status_lido    -- mudou desde o último Load
    )
  ) stored,
  raw                          jsonb,                         -- cabeçalho inteiro, cru
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint op_reqmat_pkey primary key (codigo_empresa_filial, numero)
);

comment on table public.op_reqmat is
  'Espelho read-only do cabeçalho da Requisição de Material do ERP Alvo. Sobrescrito pelo sync (OP-2.3). Nenhuma coluna é editada por tela. O vínculo com a OP NÃO mora aqui — mora em op_requisicoes.';
comment on column public.op_reqmat.descricao is
  'Texto livre do Alvo, limite duro de 40 chars (BrokenRules acima disso, §6.2). Carrega o nº da OP como PISTA HUMANA para quem atende na tela do Alvo. NÃO é o vínculo: o vínculo é op_requisicoes.op_id, gravado na criação. Não fazer parse disto.';
comment on column public.op_reqmat.codigo_centro_ctrl is
  'O CodigoCentroControle ENVIADO no insert é IGNORADO pelo Alvo: o centro gravado deriva do funcionário (§6.2, descoberta 1). Espelhar o que voltou, nunca o que foi enviado.';
comment on column public.op_reqmat.tipo_atendimento is
  'Manual | Automático. ⚠ "Automático" é o default de nascimento via API e NUNCA atende (n=71, correlação perfeita): requisição nasce aberta para sempre, sem baixar estoque e SEM ERRO. 🔴 E o campo NÃO EXISTE no contrato de integração (swagger, 04/08/2026) — não há como enviá-lo no insert de forma documentada. Enquanto o BL-15 não resolver se o binder aceita campo não documentado, esta coluna é o ÚNICO detector de RM nascida morta: RM com tipo_atendimento = "Automático" e status "Aberta" não vai atender sozinha.';
comment on column public.op_reqmat.origem is
  'Importação = criada por API (Hub). ManualAlvo = criada na tela do Alvo. É a régua de vazamento da §10.7: RM ManualAlvo não tem OP e não entra em consolidado — isso é medida, não defeito.';
comment on column public.op_reqmat.detalhes_carregados_em is
  'Timestamp do último ReqMat/Load bem-sucedido. Null = veio só da listagem e ainda não tem itens nem lotes.';
comment on column public.op_reqmat.ausente_desde is
  'Carimbado quando a RM está no espelho e não volta mais na listagem (5 RMs apagadas em 71 no período, §6.2/Resolvidas). NUNCA apagar a linha. Enquanto preenchido, a RM sai da fila de releitura.';
comment on column public.op_reqmat.precisa_releitura is
  'Fila do passo B. Releitura por STATUS, não por data: a 2187 está aberta há 30 dias e ainda pode ser atendida. ⚠ O literal terminal "Atendida Total" NÃO FOI CONFIRMADO EMPIRICAMENTE — os únicos valores observados até 04/08/2026 são "Aberta" e "Atendida Parcial". Escrito como NOT IN de conjunto explícito para que acrescentar um terminal novo seja editar a lista. A PRIMEIRA EXECUÇÃO DA OP-2.3 DEVE REPORTAR os DISTINCT status encontrados. Se o literal estiver errado, a falha é reler demais — segura. ⚠ Alterar esta expressão exige DROP + ADD da coluna gerada (Postgres não permite ALTER de expressão de coluna gerada); o índice parcial que depende dela cai junto e precisa ser recriado.';
comment on column public.op_reqmat.raw is
  'Cabeçalho cru do ReqMat/Load. São 103 campos e a maioria é irrelevante ao módulo (NomeHotel, CidadeLocacaoVeiculo, DataCheckIn — a entidade é reusada para viagem). Núcleo tipado + raw, no molde do rec_laudos.';

create index if not exists idx_op_reqmat_numero      on public.op_reqmat (numero);
create index if not exists idx_op_reqmat_status      on public.op_reqmat (status);
create index if not exists idx_op_reqmat_data        on public.op_reqmat (data desc);
create index if not exists idx_op_reqmat_origem      on public.op_reqmat (origem);
create index if not exists idx_op_reqmat_releitura   on public.op_reqmat (data desc)
  where precisa_releitura;
create index if not exists idx_op_reqmat_ausente     on public.op_reqmat (ausente_desde)
  where ausente_desde is not null;


-- ─── 2. ESPELHO · ITENS ──────────────────────────────────────────────────────
create table if not exists public.op_reqmat_itens (
  codigo_empresa_filial        text        not null default '1.01',
  numero_reqmat                text        not null,
  sequencia                    integer     not null,

  codigo_produto               text,
  codigo_alternativo_produto   text,
  codigo_prod_unid_med         text,
  posicao_prod_unid_med        integer,
  codigo_loc_armaz             text,

  -- ── quantidades (todas espelhadas, nunca calculadas) ──
  quantidade                   numeric(18,9),   -- pedido
  quantidade_atendida          numeric(18,9),   -- o que SAIU — base do ledger e do consolidado
  quantidade_saldo             numeric(18,9),   -- ⚠ já vem calculado do Alvo
  quantidade_atendida_maior    numeric(18,9),   -- excedente carimbado pelo Alvo
  quantidade_devolvida         numeric(18,9),
  quantidade_perdida           numeric(18,9),
  quantidade_separada          numeric(18,9),

  data_atendimento             timestamptz,
  data_hora_atendimento        timestamptz,
  codigo_funcionario_atendente text,

  gera_pendencia               text,
  gera_empenho                 text,
  baixa_estoque                text,
  cancelado                    text,
  estornado                    text,
  finalizou_op                 text,            -- campo novo, não mapeado antes de 04/08/2026
  numero_ord_produc            text,            -- do Alvo; null em 22/22 até hoje

  sincronizado_em              timestamptz not null default now(),
  raw                          jsonb,
  created_at                   timestamptz not null default now(),

  constraint op_reqmat_itens_pkey primary key (codigo_empresa_filial, numero_reqmat, sequencia),
  constraint op_reqmat_itens_reqmat_fkey
    foreign key (codigo_empresa_filial, numero_reqmat)
    references public.op_reqmat (codigo_empresa_filial, numero) on delete cascade
);

comment on table public.op_reqmat_itens is
  'Espelho dos itens da RM. Substituído por inteiro a cada ReqMat/Load (delete + insert): item cancelado some da resposta do Alvo e um upsert incremental deixaria lixo. A conferência do consolidado da OP é POR ITEM, nunca pelo status do cabeçalho (§10.4).';
comment on column public.op_reqmat_itens.quantidade_atendida is
  'O que efetivamente saiu do estoque. O ledger e o consolidado da OP somam ESTA coluna, nunca `quantidade` (§10.4 e §6.1-1).';
comment on column public.op_reqmat_itens.quantidade_saldo is
  'QuantidadeSaldoProdUnidMedPrincipal — JÁ VEM CALCULADO pelo Alvo. Espelhar, NUNCA recalcular: saldo NÃO é quantidade − atendida (o excedente vai para quantidade_atendida_maior e o saldo não fica negativo).';
comment on column public.op_reqmat_itens.quantidade_atendida_maior is
  'Excedente CARIMBADO pelo Alvo quando o almoxarifado entrega mais do que o pedido. Provado na RM 0000002251: seq 18 = +47, seq 19 = +121. Não inferir por atendido − pedido.';
comment on column public.op_reqmat_itens.quantidade_devolvida is
  'Sem uso hoje, tipada desde já DE PROPÓSITO: devolução de sobra no fechamento da OP é LEITURA deste campo (BL-8), não coluna nova depois.';
comment on column public.op_reqmat_itens.quantidade_perdida is
  'Sem uso hoje, tipada desde já DE PROPÓSITO: perda/reprova em produção é LEITURA deste campo (BL-8), não coluna nova depois.';
comment on column public.op_reqmat_itens.numero_ord_produc is
  'Campo NATIVO de Ordem de Produção do Alvo. Null em 22/22 na RM 0000002251, inclusive tendo a OP escrita à mão na Descrição. Espelhado assim mesmo: se um dia for gravável (BL-9), o vínculo pode virar estruturado do lado do ERP.';
comment on column public.op_reqmat_itens.finalizou_op is
  'Campo encontrado no item em 04/08/2026 ("Não" no espécime). Semântica ainda desconhecida — espelhado para não se perder.';

create index if not exists idx_op_reqmat_itens_produto  on public.op_reqmat_itens (codigo_produto);
create index if not exists idx_op_reqmat_itens_reqmat   on public.op_reqmat_itens (codigo_empresa_filial, numero_reqmat);
create index if not exists idx_op_reqmat_itens_aberto   on public.op_reqmat_itens (codigo_produto)
  where quantidade_saldo > 0;


-- ─── 3. ESPELHO · LOTES DO ITEM ──────────────────────────────────────────────
-- CtrlLoteItemReqMatChildList. Item não atendido tem ZERO lotes; item com rateio
-- tem 2+. PK surrogate de propósito: a unicidade de (item, lote) é fato
-- observado, não garantia estrutural do ERP — mesma lição da §6.3-N.
create table if not exists public.op_reqmat_lotes (
  id                           uuid        primary key default gen_random_uuid(),

  codigo_empresa_filial        text        not null default '1.01',
  numero_reqmat                text        not null,
  sequencia_item               integer     not null,

  codigo_produto               text,
  codigo_loc_armaz             text,
  numero_ctrl_lote             text,
  data_validade_ctrl_lote      date,
  quantidade                   numeric(18,9),   -- o que saiu DESTE lote
  quantidade_bruta             numeric(18,9),   -- tamanho do lote
  quantidade_unidade_item      numeric(18,9),
  operacao                     text,            -- 'Saída'
  codigo_prod_unid_med         text,
  posicao_prod_unid_med        integer,

  sincronizado_em              timestamptz not null default now(),
  raw                          jsonb,
  created_at                   timestamptz not null default now(),

  constraint op_reqmat_lotes_item_fkey
    foreign key (codigo_empresa_filial, numero_reqmat, sequencia_item)
    references public.op_reqmat_itens (codigo_empresa_filial, numero_reqmat, sequencia) on delete cascade
);

comment on table public.op_reqmat_lotes is
  'Espelho de CtrlLoteItemReqMatChildList — a genealogia de SAÍDA nativa do Alvo. O almoxarifado aloca por FEFO (5/5 itens multi-lote, sempre da validade mais antiga) e a soma dos lotes bate com o ATENDIDO. Substituído por inteiro a cada Load. Sem UNIQUE na chave natural: unicidade observada não é garantia do ERP.';
comment on column public.op_reqmat_lotes.quantidade is
  'Quantidade que saiu DESTE lote. quantidade_bruta é o tamanho do lote — não confundir.';

create index if not exists idx_op_reqmat_lotes_item     on public.op_reqmat_lotes (codigo_empresa_filial, numero_reqmat, sequencia_item);
create index if not exists idx_op_reqmat_lotes_lote     on public.op_reqmat_lotes (numero_ctrl_lote)
  where numero_ctrl_lote is not null;
create index if not exists idx_op_reqmat_lotes_produto  on public.op_reqmat_lotes (codigo_produto);


-- ─── 4. LIVRO DO HUB · vínculo OP ↔ RM ───────────────────────────────────────
-- ⚠ O SYNC NUNCA ESCREVE AQUI.
create table if not exists public.op_requisicoes (
  id                    uuid        primary key default gen_random_uuid(),
  op_id                 uuid        not null references public.op_ordens (id),

  codigo_empresa_filial text        not null default '1.01',
  numero_reqmat         text,                    -- null até o Alvo responder. NÃO é FK.

  status_envio          text        not null default 'pendente'
    constraint op_requisicoes_status_envio_check
    check (status_envio in ('pendente','enviado','confirmado','erro')),

  criado_por            uuid        not null,    -- = auth.uid(); uuid puro, sem FK (padrão do repo)
  criado_em             timestamptz not null default now(),
  enviado_em            timestamptz,
  confirmado_em         timestamptz,

  payload_enviado       jsonb,
  resposta_alvo         jsonb,
  erro_mensagem         text
);

comment on table public.op_requisicoes is
  'LIVRO DO HUB: o vínculo OP↔RM, que o Alvo não tem. Uma linha por tentativa de criação de RM contra uma OP. O sync (OP-2.3) NUNCA escreve nesta tabela. Escrita só por RPC SECURITY DEFINER com gate de permissão.';
comment on column public.op_requisicoes.numero_reqmat is
  'NÃO é FK para op_reqmat DE PROPÓSITO: a RM passa a existir no Alvo no instante do POST, e o espelho só a enxerga no sync seguinte. Uma FK recusaria a gravação exatamente no momento em que o rastro é mais necessário. O join com o espelho é por (codigo_empresa_filial, numero_reqmat) e pode não resolver por alguns minutos.';
comment on column public.op_requisicoes.status_envio is
  'pendente = linha criada, POST ainda não saiu · enviado = Alvo respondeu com um Numero · confirmado = o Load/sync releu a RM e ela existe · erro = falhou. Texto + CHECK (não enum) para que acrescentar um estado seja troca de CHECK, sem ALTER TYPE aplicado por fora antes do código.';
comment on column public.op_requisicoes.criado_em is
  'A LINHA NASCE ANTES DO POST no Alvo, de propósito. (a) A resposta de sucesso do Alvo tem ECO BUGADO — o Numero é replicado em TODOS os campos string (§6.2) — então parseia-se apenas `Numero` e confirma-se via Load/sync. (b) Se a rede cair depois de o Alvo gravar, existe RM órfã no ERP e nada no Hub: a linha pré-gravada é o único rastro para reconciliar.';
comment on column public.op_requisicoes.criado_por is
  'auth.uid() do requisitante. uuid puro, SEM FK para profiles — padrão do repo (op_ordens.emitido_por, compras_pedidos.criado_por_user_id).';
comment on column public.op_requisicoes.resposta_alvo is
  'Resposta crua do InserirAlterarRequisicaoMaterial. Guardada inteira apesar do eco bugado: é a prova do que o Alvo devolveu.';

create index if not exists idx_op_requisicoes_op          on public.op_requisicoes (op_id);
create index if not exists idx_op_requisicoes_status      on public.op_requisicoes (status_envio);
create index if not exists idx_op_requisicoes_reqmat      on public.op_requisicoes (codigo_empresa_filial, numero_reqmat)
  where numero_reqmat is not null;
create index if not exists idx_op_requisicoes_criado_por  on public.op_requisicoes (criado_por);


-- ─── 5. TRIGGER DE updated_at ────────────────────────────────────────────────
-- Reusa a função do módulo, criada na OP-1.1. NÃO criar função nova.
-- Só o cabeçalho do espelho tem updated_at: itens e lotes são substituídos por
-- inteiro a cada Load, então "atualizado" não é um conceito deles.
drop trigger if exists trg_op_reqmat_updated_at on public.op_reqmat;
create trigger trg_op_reqmat_updated_at
  before update on public.op_reqmat
  for each row execute function public.op_set_updated_at();


-- ─── 6. RLS ──────────────────────────────────────────────────────────────────
-- Padrão exato das tabelas existentes do módulo OP: SELECT gateado por
-- producao.access, em subselect (InitPlan 1x por consulta, não 1x por linha).
-- SEM policy de escrita: quem grava é a Edge Function (service_role, ignora RLS)
-- e as RPCs SECURITY DEFINER. Tabelas novas — nada que hoje é aberto foi restringido.
alter table public.op_reqmat       enable row level security;
alter table public.op_reqmat_itens enable row level security;
alter table public.op_reqmat_lotes enable row level security;
alter table public.op_requisicoes  enable row level security;

drop policy if exists op_reqmat_select on public.op_reqmat;
create policy op_reqmat_select on public.op_reqmat
  for select to authenticated
  using ( (select public.user_has_permission(auth.uid(), 'producao.access')) );

drop policy if exists op_reqmat_itens_select on public.op_reqmat_itens;
create policy op_reqmat_itens_select on public.op_reqmat_itens
  for select to authenticated
  using ( (select public.user_has_permission(auth.uid(), 'producao.access')) );

drop policy if exists op_reqmat_lotes_select on public.op_reqmat_lotes;
create policy op_reqmat_lotes_select on public.op_reqmat_lotes
  for select to authenticated
  using ( (select public.user_has_permission(auth.uid(), 'producao.access')) );

drop policy if exists op_requisicoes_select on public.op_requisicoes;
create policy op_requisicoes_select on public.op_requisicoes
  for select to authenticated
  using ( (select public.user_has_permission(auth.uid(), 'producao.access')) );


-- =============================================================================
-- VERIFICAÇÃO (rodar DEPOIS de aplicar)
-- =============================================================================
-- fingerprint do projeto (04/08/2026 = 1796; cresce com o cron de compras)
--   select count(*) as fingerprint from compras_pedidos;
--
-- as 4 tabelas existem e com quantas colunas
--   select table_name, count(*) as colunas
--     from information_schema.columns
--    where table_schema='public'
--      and table_name in ('op_reqmat','op_reqmat_itens','op_reqmat_lotes','op_requisicoes')
--    group by 1 order by 1;
--
-- ⚠ `create table if not exists` NÃO altera tabela preexistente. Se alguma já
--    existia com outra forma, a contagem acima é a única forma de perceber.
--
-- a coluna gerada existe e está STORED
--   select attname, attgenerated from pg_attribute
--    where attrelid='public.op_reqmat'::regclass and attname='precisa_releitura';   -- 's'
--
-- índices (esperado: 6 + 3 + 3 + 4, mais as PKs)
--   select tablename, indexname from pg_indexes
--    where schemaname='public' and tablename like 'op_req%' order by 1,2;
--
-- RLS ligada nas 4 e 1 policy de SELECT em cada, nenhuma de escrita
--   select relname, relrowsecurity from pg_class
--    where oid in ('public.op_reqmat'::regclass,'public.op_reqmat_itens'::regclass,
--                  'public.op_reqmat_lotes'::regclass,'public.op_requisicoes'::regclass);
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public' and tablename like 'op_req%' order by 1;
--
-- trigger
--   select tgname from pg_trigger
--    where tgrelid='public.op_reqmat'::regclass and not tgisinternal;
--
-- vazias antes do primeiro sync
--   select 'op_reqmat' t, count(*) from op_reqmat
--   union all select 'op_reqmat_itens', count(*) from op_reqmat_itens
--   union all select 'op_reqmat_lotes', count(*) from op_reqmat_lotes
--   union all select 'op_requisicoes',  count(*) from op_requisicoes;


-- =============================================================================
-- ROLLBACK (só se precisar desfazer — não há dados de produção antes do sync)
-- =============================================================================
--   drop trigger if exists trg_op_reqmat_updated_at on public.op_reqmat;
--   drop table if exists public.op_requisicoes;
--   drop table if exists public.op_reqmat_lotes;
--   drop table if exists public.op_reqmat_itens;
--   drop table if exists public.op_reqmat;
--   -- NÃO dropar public.op_set_updated_at(): é da OP-1.1 e serve op_ordens.
