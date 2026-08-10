-- =============================================================================
-- AT-4.2 · Cache do cadastro de produto — os 5 campos que o `ReqMat/Load` não dá
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Fase 4 do módulo OP — `AT-4.2.md`. Card NOVO: a AT-4 e a AT-4.1 ficam intactas.
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação empírica e rollback no fim do arquivo.
--
-- ⚠ JANELA: nada aqui é tocado pelos crons (`stock_products` não entra em
--   `sync-reqmat`). Pode aplicar a qualquer hora.
--
-- ⚠ REVISÃO 2 (10/08/2026) — três defeitos achados em teste num Postgres 16
--   local, ANTES de aplicar. Estão corrigidos e marcados no corpo como [C], [D]
--   e [E]:
--     [C] string vazia em campo integer estourava a RPC inteira
--         (`invalid input syntax for type integer: ""`). O Alvo devolve `""` com
--         frequência — o payload capturado tem `NumeroCavalete: ""` e
--         `CodigoBarras: ""`. A defesa tinha de estar na PORTA DE ESCRITA, não
--         só no chamador.
--     [D] o mesmo em `peso` (`::numeric`) e em `posicao` (`::integer`).
--     [E] 🔴 o `on conflict` NÃO protegia do que o comentário dizia proteger:
--         duas linhas com a MESMA posição no mesmo payload dão
--         "ON CONFLICT DO UPDATE command cannot affect row a second time".
--         O cenário é real (`001.003.00029` tem `CX` duplicado no cadastro).
--         Agora a deduplicação é explícita, ANTES do insert, e a duplicata é
--         REPORTADA no retorno em vez de silenciada.
--
-- ✅ FK conferida em produção pelo MCP (10/08/2026):
--    `stock_products_codigo_unique UNIQUE (codigo_produto)` existe ⇒ a FK da
--    tabela nova é válida e o desenho não muda.
--
-- ESCOPO:
--   · 12 colunas novas em `stock_products` (aditivas, todas nullable)
--   · 1 tabela nova (`stock_produto_unidades`) + RLS + policy de SELECT
--   · 1 função nova (`stock_produto_cadastro_aplicar`)
--   Nenhum cron, secret, trigger, view ou policy de ESCRITA em tabela. Sem DML.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE ISTO EXISTE
-- ─────────────────────────────────────────────────────────────────────────────
-- A tela de Atendimento do Alvo manda, no `ClassInstance` das chamadas de lote,
-- campos de CADASTRO DO PRODUTO. Medido em 10/08/2026 sobre 2.563 `raw` de
-- `op_reqmat_itens`: as chaves existem em 100% e **dez delas vêm NULAS em 100%**
-- — o `ReqMat/Load` devolve o esqueleto, não o cadastro. Sem elas o Alvo responde
-- `NullReferenceException`, que não diz qual campo falta (§4.3 do guia).
--
-- Cinco não existiam em lugar nenhum do Hub: `CodigoTipoProduto`,
-- `ControlaEstoque`, `PossuiNumSerie`, `Peso`, `PesoFatorDivisor`.
-- `Produto/Load?codigo=…&loadChild=All&loadOneToOne=All` os tem, e a comparação
-- campo a campo com a captura da tela fechou **5/5** (espécime `001.003.00087`).
--
-- ⇒ Carga ÚNICA de 258 produtos (`controla_lote = true`), cacheada aqui. Custo no
--   atendimento: ZERO chamadas. Rejeitados: `Produto/Load` sob demanda (uma
--   chamada por item, num gateway compartilhado com 100+ usuários) e o cálculo
--   local (perde a lógica do ERP).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUE TABELA, E NÃO COLUNA, PARA A ESCALA DE UNIDADES
-- ─────────────────────────────────────────────────────────────────────────────
-- `Peso` e `PesoFatorDivisor` são POR UNIDADE, não do produto: vivem na
-- `ProdUnidMedChildList`, uma linha por unidade, com `Posicao` (1 = base).
-- Guardar só a base erraria exatamente onde a conversão importa — medido:
-- **6 produtos com lote e 79 itens de RM** usam posição ≠ 1, e **5 dos 6 estão
-- atendíveis hoje**:
--
--   001.003.00017  PACOTE → MILHEI  pos 2   21 itens
--   001.003.00047  GALAO  → LITRO   pos 2   19 itens
--   001.003.00016  PACOTE → MILHEI  pos 3   13 itens
--   001.003.00015  PACOTE → MILHEI  pos 2   12 itens
--   001.003.00095  UNID   → LITRO   pos 2    8 itens
--   001.007.00019  M      → BOBINA  pos 2    6 itens
--
-- E é 1:N COM DADOS SUJOS CONHECIDOS: `001.003.00029` tem **`CX` duplicado nas
-- posições 2 e 3, com pesos 70 e 72** (§9.8). Numa PK (produto, posicao) isso
-- vira duas linhas conferíveis; num jsonb viraria ruído invisível.
--
-- ⚠ A tabela é modelada PARA ALÉM DO ATENDIMENTO: é a peça de conversão de
--   unidades do Hub, e reaparece inteira no módulo de estoque por local de
--   armazenagem. Daí a PK natural, o índice por unidade e o `sincronizado_em`
--   por linha — nada aqui é específico de RM.
--
-- 🔴 REGRA DE CONVERSÃO, PROVADA EM CAMPO (§4 do Endpoints_Alvo.md):
--       "Fator"   DIVIDE   → GALAO com LITRO peso 0,2  ⇒ 5 litros por galão
--       "Divisor" MULTIPLICA e está ERRADO — cadastrado assim, 11 galões
--                 viraram 2,2 litros (11 × 0,2).
--   ⇒ quantidade na unidade N = base ÷ peso  (Fator)  |  base × peso  (Divisor)
--   Esta regra NÃO é aplicada pelo Hub no payload — ver o bloco seguinte.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 A SEPARAÇÃO QUE NÃO SE NEGOCIA (decisão do Pedro, 10/08/2026)
-- ─────────────────────────────────────────────────────────────────────────────
--   · `Peso` / `PesoFatorDivisor` → vão ao `ClassInstance` das chamadas de lote,
--     lidos DESTE cache. São campo de cadastro; a tela envia o do cadastro.
--   · `Quantidade2` / `QuantidadeAtendida2` / `QuantidadeSaldo2` do payload do
--     Validar → seguem derivadas do PRÓPRIO ITEM (`fatorSegundaUnidade`), como
--     já estão. É o que o ERP tem gravado e o que o `ValidarAtendimento` espera.
--
-- Misturar os dois faria o Hub RECALCULAR quantidade com um fator que o ERP não
-- usa. E a divergência é real, medida: o `001.003.00047` (GALAO→LITRO) tem fator
-- observado **1,000** nos 19 itens — um galão contando como um litro. À luz da
-- regra do "Fator", isso não é "sem conversão": é **conversão FALTANDO no
-- cadastro** (o §9.8 lista GALAO→LITRO entre os 64 que exigem fator caso a caso).
-- ⇒ Divergência vira RELATÓRIO (query J na verificação), nunca conserto silencioso.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 REGRA DO PROJETO: `revoke ... from public` NÃO tranca RPC nova
-- ─────────────────────────────────────────────────────────────────────────────
-- `pg_default_acl` tem `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon` para
-- funções em `public` ⇒ toda função nova nasce aberta a `anon`, e
-- `revoke from public` não alcança grant nominal. O bloco de grants revoga de
-- `anon` POR NOME, com a assinatura completa, DEPOIS do create.
--
-- CONTRATO DE RETORNO (o mesmo das RPCs da OP-2.7/2.9/AT-3):
--   sucesso → { "success": true,  ... }
--   falha   → { "success": false, "erro_codigo": "...", "mensagem": "..." }
-- Códigos: sem_permissao · sem_sessao · sem_codigo · produto_desconhecido
-- =============================================================================


-- =============================================================================
-- 0) PRÉ-VOO (protocolo de sessão — rodar ANTES, colar o resultado)
-- =============================================================================
--   select count(*) from public.compras_pedidos;          -- esperado >= 1820
--   select count(*) from public.stock_products where controla_lote;  -- esperado 258


-- =============================================================================
-- 1) `stock_products` — 12 colunas aditivas
-- =============================================================================
-- Todas NULLABLE e sem default: `cadastro_alvo_em IS NULL` é o sinal de "sem
-- cache", e é ele que BLOQUEIA o item no atendimento (decisão 5 do
-- RETOMADA-AT-4.md: produto sem cadastro conhecido nunca assume valor).

alter table public.stock_products
  add column if not exists codigo_tipo_produto           text,
  add column if not exists controla_estoque              text,
  add column if not exists possui_num_serie              text,
  add column if not exists controla_lote_filial          text,
  add column if not exists quantidade_dias_validade_lote integer,
  add column if not exists prazo_validade                text,
  add column if not exists prazo_validade_dias           integer,
  add column if not exists numero_lote_automatico        text,
  add column if not exists base_geracao_automatica_lote  text,
  add column if not exists utiliza_dimensoes_lote        text,
  add column if not exists cadastro_alvo_em              timestamptz,
  add column if not exists cadastro_alvo_raw             jsonb;

comment on column public.stock_products.codigo_tipo_produto is
  'CodigoTipoProduto da RAIZ do Produto/Load (ex.: "44"). AT-4.2. ⚠ NÃO confundir com tipo_produto, que mistura código e nome no cadastro do Hub ("15", "Insumos", "Semi-Acabado") e NÃO serve para o payload do Alvo.';
comment on column public.stock_products.controla_estoque is
  'ControlaEstoque da raiz do Produto/Load ("Sim"/"Não"). AT-4.2. ⚠ A outra fonte aparente (rec_laudos.raw_movestq_item) é a MESMA cujo ControlaLote é falso — "Não" em 756/756 itens com lote gravado (§6.3-N). Não usar aquela.';
comment on column public.stock_products.possui_num_serie is
  'PossuiNumSerie da raiz do Produto/Load ("Sim"/"Não"). AT-4.2.';
comment on column public.stock_products.controla_lote_filial is
  'ControlaLote da ProdEmpresaFilialChildList (filial 1.01). AT-4.2. 🔴 NÃO substitui controla_lote — existe para COMPARAR: a FILIAL manda (§6.3-N), e divergência entre raiz e filial é ACHADO, não erro de carga. ⚠ A child list PODE VIR VAZIA em cadastro incompleto (ex.: 001.003.00020, §9.8): nesse caso fica NULL, nunca "Não".';
comment on column public.stock_products.quantidade_dias_validade_lote is
  'QuantidadeDiasValidadeLote da raiz do Produto/Load. AT-4.2. É o dado que permitiria uma régua de alerta de vencimento POR PRODUTO na tela de atendimento, em vez de um "<= 30 dias" fixo. A decisão da régua é da AT-5; sem este dado ela não existe. ⚠ String vazia do ERP vira NULL na própria RPC (nullif), não no chamador.';
comment on column public.stock_products.prazo_validade is
  'PrazoValidade da raiz do Produto/Load. AT-4.2. Guardado como TEXT porque o domínio não foi medido — a carga não converte o que não conhece.';
comment on column public.stock_products.prazo_validade_dias is
  'PrazoValidadeDias da raiz do Produto/Load. AT-4.2. ⚠ String vazia do ERP vira NULL na própria RPC (nullif). Valor não numérico (que não seja "") ESTOURA de propósito: seria formato novo do ERP, e falhar alto num produto é melhor que gravar NULL em silêncio nos 258.';
comment on column public.stock_products.numero_lote_automatico is
  'NumeroLoteAutomatico da raiz do Produto/Load. AT-4.2. Regra de geração de lote; ainda sem consumidor.';
comment on column public.stock_products.base_geracao_automatica_lote is
  'BaseGeracaoAutomaticaLote da raiz do Produto/Load. AT-4.2. Ainda sem consumidor.';
comment on column public.stock_products.utiliza_dimensoes_lote is
  'UtilizaDimensoesLote da raiz do Produto/Load. AT-4.2. Ainda sem consumidor.';
comment on column public.stock_products.cadastro_alvo_em is
  'Carimbo da carga de cadastro (AT-4.2). 🔴 NULL = produto SEM cache ⇒ o atendimento BLOQUEIA o item com mensagem, nunca assume valor. É o sinal que o serviço lê.';
comment on column public.stock_products.cadastro_alvo_raw is
  'Raiz do Produto/Load SEM as child lists (que viram stock_produto_unidades e colunas). AT-4.2. Existe para não custar uma segunda carga de 258 chamadas quando descobrirmos que falta um campo — mesmo princípio do raw das tabelas de espelho.';


-- =============================================================================
-- 2) `stock_produto_unidades` — a escala de conversão, uma linha por posição
-- =============================================================================
-- ⚠ PEÇA DE INFRAESTRUTURA, não de atendimento: é a tabela de conversão de
--   unidades do Hub e vai ser consumida pelo módulo de estoque por local de
--   armazenagem. Nada aqui é específico de RM.
--
-- ✅ A FK exige PK ou UNIQUE em `stock_products.codigo_produto`. Conferido em
--    produção pelo MCP em 10/08/2026: `stock_products_codigo_unique UNIQUE
--    (codigo_produto)` existe.

create table if not exists public.stock_produto_unidades (
  codigo_produto      text        not null
    references public.stock_products (codigo_produto) on delete cascade,
  -- 1 = unidade BASE do produto. É a chave junto com o produto porque o cadastro
  -- admite a MESMA unidade em duas posições: o 001.003.00029 tem `CX` nas
  -- posições 2 e 3, com pesos 70 e 72. PK por (produto, unidade) recusaria a
  -- segunda linha e esconderia o defeito de cadastro.
  posicao             integer     not null,
  codigo_unid_med     text,
  peso                numeric,
  peso_fator_divisor  text,
  sincronizado_em     timestamptz not null default now(),
  primary key (codigo_produto, posicao)
);

comment on table public.stock_produto_unidades is
  'ESCALA DE CONVERSÃO DE UNIDADES por produto, espelhada da ProdUnidMedChildList do Produto/Load (AT-4.2). Uma linha por Posicao (1 = base). 🔴 Regra do Alvo, provada em campo: "Fator" DIVIDE (GALAO com LITRO peso 0,2 => 5 litros por galão) e "Divisor" MULTIPLICA — este último está ERRADO no cadastro e já fez 11 galões virarem 2,2 litros. ⚠ O Hub NÃO usa esta tabela para recalcular Quantidade2/QuantidadeAtendida2/QuantidadeSaldo2 do payload de atendimento: aquelas seguem o fator do próprio item da RM, que é o que o ERP tem gravado. Aqui é cadastro; lá é movimento. Peça de infraestrutura — o módulo de estoque por local a consome inteira.';
comment on column public.stock_produto_unidades.posicao is
  'Posicao da unidade no cadastro. 1 = unidade BASE. Medido: 6 produtos com controle de lote usam posição <> 1 em 79 itens de RM (MILHEI, LITRO, BOBINA), e 5 deles estão atendíveis hoje.';
comment on column public.stock_produto_unidades.peso is
  'Peso da ProdUnidMedChildList. Combinado com peso_fator_divisor dá a conversão. ⚠ Ausência é NORMAL: o §9.8 registra 64 produtos que exigem fator caso a caso e 33 sem unidade-base nenhuma — cadastro incompleto no ERP, não falha da carga.';
comment on column public.stock_produto_unidades.peso_fator_divisor is
  '"Fator" (divide) | "Divisor" (multiplica, e é o cadastro ERRADO) | null. Ver o comment da tabela.';

create index if not exists idx_stock_prod_unid_produto on public.stock_produto_unidades (codigo_produto);
create index if not exists idx_stock_prod_unid_unidade on public.stock_produto_unidades (codigo_unid_med);

-- ─── RLS: SELECT para authenticated; escrita SÓ pela RPC com gate ────────────
-- O drop+create roda em transação de propósito: RLS habilitada SEM policy é
-- deny-all, e sem begin/commit haveria uma janela em que a tela leria vazio
-- (mesmo cuidado da OP-2.4 e da AT-3).
--
-- 🔴 NENHUMA POLICY DE INSERT/UPDATE/DELETE. A escrita passa pela
--    `stock_produto_cadastro_aplicar`, que é DEFINER e tem gate de permissão.
--    ⚠ `stock_products` tem hoje `Allow all for authenticated` com predicado
--      `true` para TODOS os comandos — qualquer um dos 100+ usuários escreve no
--      catálogo. É a classe do BL-5, está registrado como BL-33 e NÃO se repete
--      aqui.
begin;

alter table public.stock_produto_unidades enable row level security;

drop policy if exists stock_produto_unidades_select on public.stock_produto_unidades;
create policy stock_produto_unidades_select on public.stock_produto_unidades
  for select to authenticated
  using (true);

commit;


-- =============================================================================
-- 3) `stock_produto_cadastro_aplicar` — a única porta de escrita
-- =============================================================================
-- Gate `compras.cadastros.sync` ("Atualizar cadastros do ERP"), que já existe no
-- RBAC. Escreve o cabeçalho em `stock_products` e SUBSTITUI a escala do produto
-- num único commit (delete + insert), pelo mesmo motivo da
-- `op_reqmat_aplicar_load`: não abrir janela em que o produto apareça sem escala.
--
-- ⚠ NÃO toca em `controla_lote`, `nome_produto`, `unidade_medida` nem em
--   qualquer coluna que o catálogo já mantinha. `controla_lote` continua sendo a
--   fonte de verdade do Hub (258 true / 2.568 false, conferido em 4 espécimes de
--   campo); o que vem do Alvo entra em `controla_lote_filial`, ao lado, para
--   COMPARAR.
--
-- 🔴 [C][D] TODA leitura do jsonb passa por `nullif(…,'')`. O Alvo devolve
--    STRING VAZIA com frequência (o payload capturado tem `NumeroCavalete: ""` e
--    `CodigoBarras: ""`), e `''::integer` / `''::numeric` estouram a chamada
--    inteira. A porta de escrita se defende sozinha — não confia no chamador.
--    ⚠ Nos campos TEXT o `nullif` também se aplica, e é a semântica certa:
--      `""` num enum ("Sim"/"Não") ou num código não é valor, é ausência.
--    ⚠ Valor não numérico que NÃO seja `""` continua estourando, de propósito:
--      seria formato novo do ERP, e a carga trata a exceção por produto (o
--      produto entra em `erros[]` com a mensagem do Postgres, os outros 257
--      seguem). Falhar alto num caso desconhecido é melhor que gravar NULL em
--      silêncio em todos.
create or replace function public.stock_produto_cadastro_aplicar(
  p_codigo    text,
  p_cabecalho jsonb,
  p_unidades  jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo     text := nullif(trim(coalesce(p_codigo, '')), '');
  v_unidades   int  := 0;
  v_recebidas  int  := 0;
  v_distintas  int  := 0;
begin
  if not public._user_has_perm('compras.cadastros.sync') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para atualizar cadastros do ERP (compras.cadastros.sync).');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_sessao',
      'mensagem', 'Sessão sem auth.uid() — faça login novamente.');
  end if;
  if v_codigo is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_codigo',
      'mensagem', 'Código do produto não informado.');
  end if;

  if not exists (select 1 from public.stock_products where codigo_produto = v_codigo) then
    return jsonb_build_object('success', false, 'erro_codigo', 'produto_desconhecido',
      'mensagem', format('O produto %s não está no catálogo do Hub — sincronize o catálogo antes.', v_codigo));
  end if;

  -- Cabeçalho. Só as colunas da AT-4.2; cada uma guardada por jsonb_exists, no
  -- molde da op_reqmat_aplicar_load: chave ausente = preserva o valor atual.
  -- [C] `nullif(…,'')` em TODAS, inclusive nas de texto.
  update public.stock_products set
    codigo_tipo_produto           = case when jsonb_exists(p_cabecalho,'codigo_tipo_produto')           then nullif(p_cabecalho->>'codigo_tipo_produto','')                    else codigo_tipo_produto           end,
    controla_estoque              = case when jsonb_exists(p_cabecalho,'controla_estoque')              then nullif(p_cabecalho->>'controla_estoque','')                       else controla_estoque              end,
    possui_num_serie              = case when jsonb_exists(p_cabecalho,'possui_num_serie')              then nullif(p_cabecalho->>'possui_num_serie','')                       else possui_num_serie              end,
    controla_lote_filial          = case when jsonb_exists(p_cabecalho,'controla_lote_filial')          then nullif(p_cabecalho->>'controla_lote_filial','')                   else controla_lote_filial          end,
    quantidade_dias_validade_lote = case when jsonb_exists(p_cabecalho,'quantidade_dias_validade_lote') then nullif(p_cabecalho->>'quantidade_dias_validade_lote','')::integer else quantidade_dias_validade_lote end,
    prazo_validade                = case when jsonb_exists(p_cabecalho,'prazo_validade')                then nullif(p_cabecalho->>'prazo_validade','')                         else prazo_validade                end,
    prazo_validade_dias           = case when jsonb_exists(p_cabecalho,'prazo_validade_dias')           then nullif(p_cabecalho->>'prazo_validade_dias','')::integer          else prazo_validade_dias           end,
    numero_lote_automatico        = case when jsonb_exists(p_cabecalho,'numero_lote_automatico')        then nullif(p_cabecalho->>'numero_lote_automatico','')                 else numero_lote_automatico        end,
    base_geracao_automatica_lote  = case when jsonb_exists(p_cabecalho,'base_geracao_automatica_lote')  then nullif(p_cabecalho->>'base_geracao_automatica_lote','')           else base_geracao_automatica_lote  end,
    utiliza_dimensoes_lote        = case when jsonb_exists(p_cabecalho,'utiliza_dimensoes_lote')        then nullif(p_cabecalho->>'utiliza_dimensoes_lote','')                 else utiliza_dimensoes_lote        end,
    cadastro_alvo_raw             = coalesce(p_cabecalho->'raw', cadastro_alvo_raw),
    cadastro_alvo_em              = now()
  where codigo_produto = v_codigo;

  -- Escala: substituição por inteiro, num único commit.
  -- ⚠ Lista VAZIA não apaga: produto sem ProdUnidMedChildList é cadastro
  --   incompleto no ERP (o §9.8 conta 33 sem unidade-base), e apagar a escala boa
  --   por causa de um Load degradado seria o mesmo defeito do "p_itens vazio" da
  --   op_reqmat_aplicar_load. A carga reporta esses casos.
  if p_unidades is not null and jsonb_typeof(p_unidades) = 'array' and jsonb_array_length(p_unidades) > 0 then

    -- [E] Mede a duplicata ANTES de gravar. Duas linhas com a mesma `posicao` no
    --     mesmo payload são cenário REAL (o `001.003.00029` tem `CX` nas posições
    --     2 e 3 — e nada impede o cadastro de repetir a posição). A versão
    --     anterior tentava resolver com `on conflict`, que NÃO resolve: o Postgres
    --     recusa a instrução inteira com "ON CONFLICT DO UPDATE command cannot
    --     affect row a second time". A deduplicação é explícita, e o número sai
    --     no retorno para a carga reportar em vez de silenciar.
    select count(*), count(distinct posicao)
      into v_recebidas, v_distintas
      from (
        select nullif(u->>'posicao','')::integer as posicao
          from jsonb_array_elements(p_unidades) u
      ) medidas
     where posicao is not null;

    delete from public.stock_produto_unidades where codigo_produto = v_codigo;

    -- [D] `nullif(…,'')` antes de cada cast; `posicao` sem valor é descartada,
    --     não vira 0 — posição 0 seria uma unidade inventada.
    -- [E] `distinct on (posicao)` com `order by posicao, ord`: a PRIMEIRA
    --     ocorrência do payload vence, de forma determinística.
    insert into public.stock_produto_unidades
      (codigo_produto, posicao, codigo_unid_med, peso, peso_fator_divisor)
    select distinct on (e.posicao)
      v_codigo, e.posicao, e.codigo_unid_med, e.peso, e.peso_fator_divisor
    from (
      select
        nullif(u->>'posicao','')::integer   as posicao,
        nullif(u->>'codigo_unid_med','')    as codigo_unid_med,
        nullif(u->>'peso','')::numeric      as peso,
        nullif(u->>'peso_fator_divisor','') as peso_fator_divisor,
        ord
      from jsonb_array_elements(p_unidades) with ordinality as t(u, ord)
    ) e
    where e.posicao is not null
    order by e.posicao, e.ord;

    get diagnostics v_unidades = row_count;
  end if;

  return jsonb_build_object(
    'success',              true,
    'codigo',               v_codigo,
    'unidades',             v_unidades,
    'unidades_recebidas',   v_recebidas,
    -- > 0 significa posição repetida no cadastro do produto: a carga registra e
    -- o Pedro decide. O Hub não conserta cadastro do ERP.
    'posicoes_duplicadas',  greatest(0, v_recebidas - v_distintas)
  );
end $function$;

comment on function public.stock_produto_cadastro_aplicar(text, jsonb, jsonb) is
  'AT-4.2 · Única porta de escrita do cache de cadastro de produto. Gate compras.cadastros.sync. Grava as 12 colunas novas de stock_products (guardadas por jsonb_exists) e SUBSTITUI a escala do produto em stock_produto_unidades num único commit. NÃO toca em controla_lote, nome_produto nem unidade_medida — o que vem do Alvo entra em controla_lote_filial, ao lado, para comparar. Lista de unidades vazia NÃO apaga a escala existente (cadastro incompleto no ERP é normal: 33 produtos sem unidade-base, §9.8). 🔴 Toda leitura do jsonb passa por nullif(...,''), porque o Alvo devolve string vazia com frequência e ''::integer estoura a chamada inteira. 🔴 Posição repetida no MESMO payload é deduplicada por distinct on (primeira ocorrência vence) e CONTADA em posicoes_duplicadas no retorno — on conflict não serve aqui: o Postgres recusa a instrução com "cannot affect row a second time".';


-- =============================================================================
-- 4) GRANTS — `authenticated` sim, `anon` NÃO (assinatura completa, POR NOME)
-- =============================================================================
revoke execute on function public.stock_produto_cadastro_aplicar(text, jsonb, jsonb) from public;
revoke execute on function public.stock_produto_cadastro_aplicar(text, jsonb, jsonb) from anon;
grant  execute on function public.stock_produto_cadastro_aplicar(text, jsonb, jsonb) to authenticated;


-- =============================================================================
-- 5) PostgREST — recarregar o cache de schema
-- =============================================================================
-- Sem isto, `supabase.rpc('stock_produto_cadastro_aplicar', …)` responde 404 e as
-- colunas novas não aparecem no `select` do PostgREST.
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar — colar tudo)
-- =============================================================================
-- a) As 12 colunas existem, com os tipos certos:
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='stock_products'
--      and column_name in ('codigo_tipo_produto','controla_estoque','possui_num_serie',
--        'controla_lote_filial','quantidade_dias_validade_lote','prazo_validade',
--        'prazo_validade_dias','numero_lote_automatico','base_geracao_automatica_lote',
--        'utiliza_dimensoes_lote','cadastro_alvo_em','cadastro_alvo_raw')
--    order by column_name;
--
--   Esperado: 12 linhas, todas is_nullable = YES.
--
-- b) A tabela nova, com PK composta, FK e RLS ligada:
--
--   select c.relrowsecurity as rls, p.polname, p.polcmd
--     from pg_class c left join pg_policy p on p.polrelid = c.oid
--    where c.relname = 'stock_produto_unidades';
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint where conrelid='public.stock_produto_unidades'::regclass
--    order by contype;
--
--   Esperado: rls = t · 1 policy `stock_produto_unidades_select` · polcmd = r ·
--   PK (codigo_produto, posicao) · FK para stock_products(codigo_produto).
--   🔴 Se aparecer policy de INSERT/UPDATE/DELETE, algo foi acrescentado por fora.
--
-- c) A função é DEFINER, com search_path, owner postgres, e `anon` NÃO chama:
--
--   select proname, prosecdef as security_definer, proconfig as search_path,
--          pg_get_userbyid(proowner) as owner,
--          has_function_privilege('anon',          oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth
--     from pg_proc
--    where pronamespace='public'::regnamespace and proname='stock_produto_cadastro_aplicar';
--
--   Esperado: security_definer = t · owner = postgres · anon = FALSE · auth = TRUE.
--   🔴 `anon` TRUE = a seção 4 não rodou. É o defeito da OP-2.7 se repetindo.
--
-- d) O gate dispara (smoke NEGATIVO — o Editor roda sem auth.uid()):
--
--   select public.stock_produto_cadastro_aplicar('001.003.00087', '{}'::jsonb);
--
--   Esperado: {"success": false, "erro_codigo": "sem_permissao", ...}.
--
-- e) Nada foi escrito ainda (a carga é pelo app):
--
--   select count(*) as com_cache from public.stock_products where cadastro_alvo_em is not null;
--   select count(*) as linhas_escala from public.stock_produto_unidades;
--
--   Esperado: 0 e 0. Depois da carga: ver (f) a (j).
--
-- ── DEPOIS DA CARGA (o Pedro roda pelo botão em Configurações) ───────────────
--
-- f) Cobertura da carga:
--
--   select count(*) filter (where controla_lote) as alvo_da_carga,
--          count(*) filter (where controla_lote and cadastro_alvo_em is not null) as com_cache,
--          count(*) filter (where controla_lote and cadastro_alvo_em is null) as sem_cache
--     from public.stock_products;
--
--   Esperado: 258 / 258 / 0. Qualquer `sem_cache` BLOQUEIA o item no atendimento.
--
-- g) Os cinco campos que motivaram a carga:
--
--   select count(*) filter (where codigo_tipo_produto is not null) as tipo,
--          count(*) filter (where controla_estoque    is not null) as estoque,
--          count(*) filter (where possui_num_serie    is not null) as num_serie
--     from public.stock_products where controla_lote;
--
--   select count(*) as linhas,
--          count(*) filter (where peso is not null) as com_peso,
--          count(*) filter (where peso_fator_divisor is not null) as com_regra,
--          count(*) filter (where peso_fator_divisor = 'Divisor') as regra_divisor_ERRADA
--     from public.stock_produto_unidades;
--
--   ⚠ `regra_divisor_ERRADA` > 0 é achado de CADASTRO para a Controladoria: o
--     "Divisor" multiplica, e é como 11 galões viraram 2,2 litros.
--
-- h) 🔴 Divergência raiz × filial no ControlaLote (a FILIAL manda, §6.3-N):
--
--   select codigo_produto, controla_lote as hub, controla_lote_filial as alvo_filial
--     from public.stock_products
--    where controla_lote and cadastro_alvo_em is not null
--      and controla_lote_filial is distinct from (case when controla_lote then 'Sim' else 'Não' end)
--    order by codigo_produto;
--
--   Esperado: 0 linhas. Cada linha é ACHADO — inclusive `controla_lote_filial`
--   NULL, que significa ProdEmpresaFilialChildList vazia (cadastro incompleto).
--
-- i) A régua de vencimento por produto (insumo da AT-5):
--
--   select count(*) filter (where quantidade_dias_validade_lote is not null) as com_regua,
--          count(*) filter (where quantidade_dias_validade_lote is null)     as sem_regua,
--          min(quantidade_dias_validade_lote), max(quantidade_dias_validade_lote)
--     from public.stock_products where controla_lote;
--
--   Sem cobertura razoável, a régua por produto não existe e a AT-5 fica com um
--   limiar fixo — a decisão é da AT-5, não deste arquivo.
--
-- j) 🔴 RELATÓRIO DE DIVERGÊNCIA: peso do cadastro × fator observado nos itens.
--    O Hub NÃO conserta nada com isto — é insumo do §9.8. "Fator" DIVIDE, então
--    o fator esperado é 1/peso; "Divisor" MULTIPLICA (e é o cadastro errado).
--
--   with observado as (
--     select i.codigo_produto, i.posicao_prod_unid_med as posicao, i.codigo_prod_unid_med as unidade,
--            count(*) as itens,
--            round(avg((i.raw->>'Quantidade2')::numeric / nullif(i.quantidade,0)), 6) as fator_observado
--       from public.op_reqmat_itens i
--       join public.stock_products sp on sp.codigo_produto = i.codigo_produto
--      where sp.controla_lote and coalesce(i.posicao_prod_unid_med,1) <> 1
--        and i.raw is not null and i.quantidade > 0
--      group by 1,2,3
--   )
--   select o.*, u.peso, u.peso_fator_divisor,
--          case
--            when u.peso is null or u.peso = 0 then null
--            when u.peso_fator_divisor = 'Fator'   then round(1.0 / u.peso, 6)
--            when u.peso_fator_divisor = 'Divisor' then round(u.peso, 6)
--            else null
--          end as fator_do_cadastro
--     from observado o
--     left join public.stock_produto_unidades u
--            on u.codigo_produto = o.codigo_produto and u.posicao = o.posicao
--    order by o.itens desc;
--
--   Medido ANTES da carga (10/08/2026), para comparar: 001.003.00017 MILHEI 0,001 ·
--   001.003.00047 LITRO **1,000** · 001.003.00016 MILHEI 0,001 · 001.003.00015
--   MILHEI 0,001 · 001.003.00095 LITRO **1,000** · 001.007.00019 BOBINA 0,001.
--   ⚠ Os dois de fator 1,000 são pares GALAO→LITRO e UNID→LITRO: não é "sem
--     conversão", é conversão FALTANDO no cadastro — um galão contando como um
--     litro. Se o cadastro disser 0,2/"Fator" (= 5) e o item disser 1,000, a
--     divergência é REAL e vai para o §9.8. O payload continua usando o fator do
--     ITEM (a separação do bloco de decisões acima).


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Reverte 100% do arquivo. ⚠ A ORDEM IMPORTA: a função sai antes das colunas que
-- ela referencia, senão qualquer chamada residual quebra em runtime.
-- ⚠ E o serviço de atendimento (AT-4.2) passa a bloquear TODO item com lote, por
--   `cadastro_alvo_em` inexistente — reverter o SQL exige reverter o TypeScript.
--
--   -- 1. A porta de escrita
--   drop function if exists public.stock_produto_cadastro_aplicar(text, jsonb, jsonb);
--   notify pgrst, 'reload schema';
--
--   -- 2. A escala (⚠ apaga o cache de unidades; a carga o refaz em ~3,5 min)
--   drop policy if exists stock_produto_unidades_select on public.stock_produto_unidades;
--   drop table if exists public.stock_produto_unidades;
--
--   -- 3. As colunas (⚠ apaga o cache de cadastro)
--   alter table public.stock_products
--     drop column if exists codigo_tipo_produto,
--     drop column if exists controla_estoque,
--     drop column if exists possui_num_serie,
--     drop column if exists controla_lote_filial,
--     drop column if exists quantidade_dias_validade_lote,
--     drop column if exists prazo_validade,
--     drop column if exists prazo_validade_dias,
--     drop column if exists numero_lote_automatico,
--     drop column if exists base_geracao_automatica_lote,
--     drop column if exists utiliza_dimensoes_lote,
--     drop column if exists cadastro_alvo_em,
--     drop column if exists cadastro_alvo_raw;
