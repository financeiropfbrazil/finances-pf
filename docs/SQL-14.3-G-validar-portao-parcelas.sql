-- =====================================================================
-- §14.3 [G] — VALIDAR O DIAGNÓSTICO DAS PARCELAS CONGELADAS
--             sem alterar uma linha de código
-- Preparado em 28/08/2026. Pedro executa no SQL Editor.
-- =====================================================================
--
-- POR QUE ESTE PASSO VEM ANTES DO PATCH
-- O diagnóstico diz que as parcelas congelam porque a única rotina que as reescreve
-- (`persistirItensPedido` → RPC `sync_replace_filhos_pedido`) está atrás de um portão
-- de **PRESENÇA**, não de coerência: `if (ped.detalhes_carregados !== true || filhosAusentes)`,
-- com `filhosAusentes` = "jsonb nulo ou vazio". Com `detalhes_carregados = true` em
-- 100% do universo, o portão está fechado e o cabeçalho segue o Alvo sozinho.
--
-- **Se o diagnóstico estiver certo**, reabrir o portão para esses pedidos faz o cron
-- reescrever as parcelas e a divergência sumir — usando só mecanismo que já roda em
-- produção. **Se estiver errado, nada converge e NENHUM arquivo foi tocado.**
-- É o teste mais barato que existe para esta hipótese, e por isso vem primeiro.
--
-- 🔴 POPULAÇÃO REMEDIDA (MCP, 28/08/2026 17:31 UTC) — os números do card envelheceram
-- em meio dia, como a §2 item 8 avisa:
--
--   | Medida                                                     |    Valor |
--   |------------------------------------------------------------|---------:|
--   | Pedidos com parcelas locais                                 |  **368** (era 365) |
--   | Divergentes (soma das parcelas ≠ valor_total)               |   **28** (era 26)  |
--   | Valor absoluto da divergência                               | **R$ 241.024,08** |
--   | Destes, em status TERMINAL                                  |   **10** |
--
-- 🔴 E O PASSIVO MAIOR, agora desdobrado (era só "902"):
--
--   | Pedidos SEM parcela local mas COM parcelas no último Load    |  **902** |
--   | └ em status TERMINAL (documento que não muda mais)           |  **665** |
--   | └ **VIVOS**                                                  |  **237** |
--
--   ⇒ O passivo acionável é da ordem de **237**, não 902. Os 665 terminais são
--     decisão de negócio: espelhar histórico que não muda mais tem valor de
--     relatório, não de operação. **Este SQL não os toca.**
--
-- ⚠️ ESCOPO DESTE ARQUIVO: só os divergentes. O backfill dos 237/902 é card à parte
--    e depende do critério de negócio (§5).
--
-- ⚠️ RISCO E ROLLBACK. A RPC de sync **apaga e reinsere** os filhos do pedido — e
--    isso inclui `compras_pedidos_itens_rateio`, não só as parcelas. Por isso o
--    BLOCO 1 tira snapshot das **duas** tabelas. `compras_pedidos_parcelas` não tem
--    `updated_at`: o snapshot é a única rede.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 0 — PRÉ-VOO
-- ---------------------------------------------------------------------
select current_database()                                          as db,
       (select count(*) from public.compras_pedidos)                as fp_pedidos,
       (to_regclass('public.compras_pedidos_parcelas') is not null) as fp_parcelas,
       now() at time zone 'UTC'                                     as agora_utc;


-- ---------------------------------------------------------------------
-- BLOCO 1 — SNAPSHOT. É o rollback. Roda ANTES de qualquer escrita.
-- Tabelas de snapshot são criadas com sufixo de data para não colidir com
-- uma segunda rodada.
-- ---------------------------------------------------------------------
create table if not exists public.snap_g_parcelas_20260828 as
select pp.*, now() as snap_em
from public.compras_pedidos_parcelas pp
where pp.pedido_id in (
  select p.id from public.compras_pedidos p
  join (select pedido_id, sum(valor_parcela) as soma from public.compras_pedidos_parcelas group by 1) s
    on s.pedido_id = p.id
  where abs(coalesce(p.valor_total,0) - s.soma) > 0.005
);

create table if not exists public.snap_g_rateio_20260828 as
select ir.*, now() as snap_em
from public.compras_pedidos_itens_rateio ir
where ir.item_id in (
  select i.id from public.compras_pedidos_itens i
  where i.pedido_id in (
    select p.id from public.compras_pedidos p
    join (select pedido_id, sum(valor_parcela) as soma from public.compras_pedidos_parcelas group by 1) s
      on s.pedido_id = p.id
    where abs(coalesce(p.valor_total,0) - s.soma) > 0.005
  )
);

create table if not exists public.snap_g_flags_20260828 as
select p.id, p.numero, p.status, p.valor_total, p.detalhes_carregados, p.synced_at, now() as snap_em
from public.compras_pedidos p
join (select pedido_id, sum(valor_parcela) as soma from public.compras_pedidos_parcelas group by 1) s
  on s.pedido_id = p.id
where abs(coalesce(p.valor_total,0) - s.soma) > 0.005;

select (select count(*) from public.snap_g_parcelas_20260828) as parcelas_no_snapshot,
       (select count(*) from public.snap_g_rateio_20260828)   as rateios_no_snapshot,
       (select count(*) from public.snap_g_flags_20260828)    as pedidos_no_snapshot;
-- 🔴 `pedidos_no_snapshot` DEVE bater com o BLOCO 2. Se der 0, PARE: o snapshot
--    falhou e não há rede.


-- ---------------------------------------------------------------------
-- BLOCO 2 — PREVIEW. Não escreve nada. A lista exata que será reaberta.
-- ---------------------------------------------------------------------
with parc as (select pedido_id, sum(valor_parcela) as soma, count(*) as n from public.compras_pedidos_parcelas group by 1)
select p.numero, p.status, p.criado_no_hub, p.valor_total, parc.soma as soma_parcelas, parc.n as qtd_parcelas,
       round((coalesce(p.valor_total,0) - parc.soma)::numeric, 2) as diferenca,
       p.detalhes_carregados, p.synced_at::date as ultimo_sync,
       (p.status in ('Encerrado','Cancelado','Cancelado Parcial')) as terminal
from public.compras_pedidos p join parc on parc.pedido_id = p.id
where abs(coalesce(p.valor_total,0) - parc.soma) > 0.005
order by abs(coalesce(p.valor_total,0) - parc.soma) desc;
-- Esperado em 28/08/2026 17:31 UTC: **28 linhas**, R$ 241.024,08 de |diferença|,
-- 10 delas terminais. O número muda a cada ciclo — confira o que vier, não o que
-- está escrito aqui.


-- ---------------------------------------------------------------------
-- BLOCO 3 — APPLY. Reabre o portão. Idempotente.
--
-- `detalhes_carregados = false` recoloca o pedido na fila do Job 2 pelo ramo
-- `detalhes_carregados.not.is.true` — e é por isso que alcança também os **10
-- terminais**, que o SELECT de candidatos exclui quando a flag está true.
-- `synced_at = null` joga para o topo da fila (ordem asc, nulo primeiro) — o truque
-- já registrado na §5, usado para validar 0004602 e 0004640.
--
-- ⛔ EXCEÇÃO OBRIGATÓRIA — 0003872 fica de fora. Nele o **próprio Alvo** está
--    incoerente (ValorTotal R$ 13.900 contra R$ 17.514 de soma de parcelas no último
--    Load). Espelhar não resolve: é correção no ERP. Reprocessá-lo só produziria
--    ruído no VERIFY.
--
-- ⚠️ NÃO toca status, valores, nem a âncora. Só duas flags de controle de fila.
-- ---------------------------------------------------------------------
begin;

with parc as (select pedido_id, sum(valor_parcela) as soma from public.compras_pedidos_parcelas group by 1),
alvos as (
  select p.id from public.compras_pedidos p join parc on parc.pedido_id = p.id
  where abs(coalesce(p.valor_total,0) - parc.soma) > 0.005
    and p.numero <> '0003872'
)
update public.compras_pedidos p
   set detalhes_carregados = false,
       synced_at = null
 where p.id in (select id from alvos)
   and (p.detalhes_carregados is distinct from false or p.synced_at is not null);

commit;

-- Quantos ficaram elegíveis (deve ser o do BLOCO 2 menos o 0003872):
select count(*) as reabertos from public.compras_pedidos
where detalhes_carregados is false and synced_at is null;


-- ---------------------------------------------------------------------
-- BLOCO 4 — ESPERAR. Não é passo de SQL, é passo de operação.
--
-- 🔴 Esperar 1 a 2 ciclos VÁLIDOS, dentro de 11h–20h UTC em dia útil. Ciclo que não
--    rodou não prova nada: o Alvo tem janela noturna e invocação fora dela devolve
--    404 HTML (registrado na §11.3 — 150 consultados, 0 mudaram, 152 erros).
--
-- Critério de ciclo VÁLIDO, antes de acreditar em qualquer VERIFY:
-- ---------------------------------------------------------------------
select started_at, job_type, total_candidatos, total_consultados, total_mudaram, total_erros, observacao
from public.sync_runs
where job_type = 'bicephalous'
order by started_at desc limit 5;
-- 🔴 Só siga se o ciclo mais recente tiver `total_erros` baixo **E**
--    `total_mudaram > 0`. Os dois, não um.


-- ---------------------------------------------------------------------
-- BLOCO 5 — VERIFY. É aqui que o diagnóstico passa ou cai.
-- ---------------------------------------------------------------------
-- (5a) Os divergentes convergiram?
with parc as (select pedido_id, sum(valor_parcela) as soma from public.compras_pedidos_parcelas group by 1)
select s.numero,
       s.valor_total          as valor_total_antes,
       p.valor_total          as valor_total_depois,
       (select sum(x.valor_parcela) from public.snap_g_parcelas_20260828 x where x.pedido_id = s.id) as soma_antes,
       parc.soma              as soma_depois,
       round((coalesce(p.valor_total,0) - coalesce(parc.soma,0))::numeric, 2) as diferenca_agora,
       p.detalhes_carregados, p.synced_at
from public.snap_g_flags_20260828 s
join public.compras_pedidos p on p.id = s.id
left join parc on parc.pedido_id = s.id
order by abs(coalesce(p.valor_total,0) - coalesce(parc.soma,0)) desc;
--
-- 🟢 DIAGNÓSTICO CONFIRMADO: `diferenca_agora` ≈ 0 na maioria, e
--    `detalhes_carregados` voltou a true (o cron reprocessou).
-- 🔴 DIAGNÓSTICO REFUTADO: as diferenças continuam iguais **com**
--    `detalhes_carregados = true` de novo — ou seja, o cron passou por eles e não
--    reescreveu as parcelas. Nesse caso o portão não é a causa, e o patch proposto
--    não resolveria. **Registre e pare; não improvise um segundo patch.**
-- 🟡 INDETERMINADO: `detalhes_carregados` ainda false ⇒ o cron não os alcançou
--    (fila grande, ou fora do corte de 180 dias). Espere outro ciclo antes de
--    concluir qualquer coisa.

-- (5b) Nada além das parcelas pode ter mudado. O rateio tem de voltar igual.
select 'rateio' as o_que,
       (select count(*) from public.snap_g_rateio_20260828)  as antes,
       (select count(*) from public.compras_pedidos_itens_rateio ir
          where ir.item_id in (select distinct item_id from public.snap_g_rateio_20260828)) as depois;
-- Contagens diferentes NÃO são necessariamente erro (a RPC consolida), mas exigem
-- olhar linha a linha antes de seguir.

-- (5c) A âncora continua íntegra? Este passo não deveria tocar valor nenhum.
select p.numero, p.valor_total, a.valor_total as anc_total
from public.compras_pedidos p
join public.compras_pedidos_anchor a on a.pedido_id = p.id and a.rodada = 'C3.3-t0'
where p.id in (select id from public.snap_g_flags_20260828)
  and p.valor_total is distinct from a.valor_total;
-- ⚠️ Linha aqui NÃO é corrupção por si só — a âncora é de 24/08 e o Alvo pode ter
--    mudado o valor desde então, que é exatamente o fenômeno do card. Serve para
--    saber QUAIS mudaram, não para acusar.


-- =====================================================================
-- ROLLBACK — NÃO EXECUTAR. Só para guardar.
-- Restaura parcelas, rateio e as duas flags a partir dos snapshots.
-- =====================================================================
-- begin;
-- delete from public.compras_pedidos_parcelas
--  where pedido_id in (select distinct pedido_id from public.snap_g_parcelas_20260828);
-- insert into public.compras_pedidos_parcelas
--   select (s).* from (select s from public.snap_g_parcelas_20260828 s) t;  -- conferir colunas antes
-- delete from public.compras_pedidos_itens_rateio
--  where item_id in (select distinct item_id from public.snap_g_rateio_20260828);
-- insert into public.compras_pedidos_itens_rateio
--   select (s).* from (select s from public.snap_g_rateio_20260828 s) t;    -- conferir colunas antes
-- update public.compras_pedidos p
--    set detalhes_carregados = s.detalhes_carregados, synced_at = s.synced_at
--   from public.snap_g_flags_20260828 s where s.id = p.id;
-- commit;
-- ⚠️ O `select (s).*` acima precisa ser conferido contra as colunas reais antes de
--    rodar — o snapshot tem a coluna extra `snap_em`, que NÃO existe na tabela.


-- =====================================================================
-- 5. O QUE ESTE ARQUIVO **NÃO** DECIDE — e é a pergunta maior
-- =====================================================================
-- Dos 902 pedidos com parcelas no Alvo e nenhuma local, **665 são terminais** e
-- **237 estão vivos**. Antes de escolher entre "corrigir o portão" e "backfill em
-- massa", falta o critério de negócio: **quais tipos/status DEVEM ter parcelas
-- espelhadas?** Sem ele, 902 dimensiona o alcance do portão, não a dívida — e um
-- backfill de 665 documentos encerrados é trabalho e risco sem consumidor.
--
-- A pergunta prática que decide: **alguma tela, relatório ou RPC lê
-- `compras_pedidos_parcelas` de pedido terminal?** Se não lê, os 665 saem da conta
-- e o passivo real são os 237.
