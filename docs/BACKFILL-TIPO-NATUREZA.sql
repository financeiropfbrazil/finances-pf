-- =====================================================================
-- BACKFILL — compras_pedidos.tipo (NATUREZA da compra)
-- Preparado em 27/08/2026. Executar SOMENTE DEPOIS do deploy do cron.
-- =====================================================================
--
-- POR QUE ESTE BACKFILL EXISTE
-- A coluna `tipo` deveria carregar a NATUREZA (Produto/Serviço/Misto). O Job 1
-- do cron gravava `ped.Tipo`, que é o tipo de ENTREGA do Alvo — "Total" em
-- 4.746 leituras e "Programado" em 2. Produto/Serviço/Misto: ZERO. O Alvo nunca
-- teve esse dado.
-- Resultado: 916 pedidos gravados como "Total" e o filtro de natureza da tela
-- devolvendo 0 de 233 (jun), 0 de 214 (jul) e 0 de 214 (ago).
--
-- NÃO SE BUSCA NO ERP. A natureza se DERIVA de valor_mercadoria × valor_servico,
-- que já estão em compras_pedidos. Zero chamadas ao gateway.
--
-- 🔴 ORDEM OBRIGATÓRIA: o fix do cron (derivarNaturezaPedido) tem de estar
-- DEPLOYADO ANTES deste backfill. Se rodar antes, o Job 1 de descoberta volta a
-- gravar "Total" por cima do que este script corrigiu.
--
-- REGRA DE DERIVAÇÃO (idêntica ao código, decidida pelo Pedro em 27/08):
--   Misto    ← valor_mercadoria > 0  E  valor_servico > 0
--   Produto  ← valor_mercadoria > 0  E  valor_servico = 0
--   Serviço  ← valor_servico > 0     E  valor_mercadoria = 0
--   NULL     ← ambos zero/null  → natureza indeterminável, NÃO é "Misto".
--              A tela exibe "—" (ComprasPedidosCompra.tsx, tipoBadge).
--
-- Gêmeos no código — se mudar a regra aqui, mude nos dois:
--   supabase/functions/sync-compras-status-cron/index.ts  → derivarNaturezaPedido
--   src/services/alvoPedCompService.ts                    → derivarNaturezaPedido
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 0 — PRÉ-VOO. Confirma o projeto ANTES de qualquer escrita.
-- Esperado: fp_pedidos na casa dos milhares (ordem de 2.000 em ago/2026).
-- O número exato NÃO é critério — quem identifica o projeto é o project_ref
-- hbtggrbauguukewiknew na conexão.
-- ---------------------------------------------------------------------
select current_database()                                   as db,
       (select count(*) from public.compras_pedidos)        as fp_pedidos,
       (select to_regclass('public.compras_pedidos_itens_rateio') is not null) as fp_tem_rateio,
       now()                                                as agora_utc;


-- ---------------------------------------------------------------------
-- BLOCO 1 — PREVIEW. Não escreve nada.
-- Mostra, por categoria: o que está gravado hoje × o que a regra deriva.
-- ---------------------------------------------------------------------
with derivado as (
  select p.id,
         p.tipo as tipo_atual,
         case
           when coalesce(p.valor_mercadoria,0) > 0 and coalesce(p.valor_servico,0) > 0 then 'Misto'
           when coalesce(p.valor_mercadoria,0) > 0 then 'Produto'
           when coalesce(p.valor_servico,0)    > 0 then 'Serviço'
           else null
         end as tipo_novo,
         p.valor_total
  from public.compras_pedidos p
)
select coalesce(tipo_atual,'(null)')            as de,
       coalesce(tipo_novo,'(null)')             as para,
       count(*)                                 as pedidos,
       to_char(sum(valor_total),'FM999G999G999D00') as valor,
       case when tipo_atual is distinct from tipo_novo then 'MUDA' else 'ja correto' end as acao
from derivado
group by 1,2,5
order by acao desc, pedidos desc;


-- ---------------------------------------------------------------------
-- BLOCO 2 — PREVIEW do resultado final (como a tela vai ficar).
-- ---------------------------------------------------------------------
select case
         when coalesce(valor_mercadoria,0) > 0 and coalesce(valor_servico,0) > 0 then 'Misto'
         when coalesce(valor_mercadoria,0) > 0 then 'Produto'
         when coalesce(valor_servico,0)    > 0 then 'Serviço'
         else '(null) — exibido como "—"'
       end                                          as tipo_depois,
       count(*)                                     as pedidos,
       to_char(sum(valor_total),'FM999G999G999D00') as valor
from public.compras_pedidos
group by 1 order by 2 desc;


-- ---------------------------------------------------------------------
-- BLOCO 3 — APPLY. Idempotente: só toca linhas em que o valor difere.
-- Rodar duas vezes é seguro — a segunda atualiza 0 linhas.
-- ---------------------------------------------------------------------
update public.compras_pedidos p
   set tipo = case
                when coalesce(p.valor_mercadoria,0) > 0 and coalesce(p.valor_servico,0) > 0 then 'Misto'
                when coalesce(p.valor_mercadoria,0) > 0 then 'Produto'
                when coalesce(p.valor_servico,0)    > 0 then 'Serviço'
                else null
              end
 where p.tipo is distinct from case
                when coalesce(p.valor_mercadoria,0) > 0 and coalesce(p.valor_servico,0) > 0 then 'Misto'
                when coalesce(p.valor_mercadoria,0) > 0 then 'Produto'
                when coalesce(p.valor_servico,0)    > 0 then 'Serviço'
                else null
              end;
-- ⚠️ NÃO toca `updated_at` de propósito: `tipo` é dado derivado, não mudança de
-- estado do pedido. Mexer no updated_at rotacionaria a fila do cron sem motivo.


-- ---------------------------------------------------------------------
-- BLOCO 4 — VERIFY. Remede na hora. Esperado DEPOIS do apply:
--   Produto 1.229 · Serviço 728 · Misto 1 · (null) 19
--   divergentes = 0   e   ainda_como_Total = 0
-- (as contagens de Produto/Serviço sobem com o tempo; o que tem de ser ZERO
--  são as duas últimas linhas)
-- ---------------------------------------------------------------------
select coalesce(tipo,'(null)') as tipo, count(*) as pedidos
from public.compras_pedidos group by 1 order by 2 desc;

select
  (select count(*) from public.compras_pedidos
    where tipo is distinct from case
            when coalesce(valor_mercadoria,0) > 0 and coalesce(valor_servico,0) > 0 then 'Misto'
            when coalesce(valor_mercadoria,0) > 0 then 'Produto'
            when coalesce(valor_servico,0)    > 0 then 'Serviço'
            else null end)                                as divergentes_deve_ser_0,
  (select count(*) from public.compras_pedidos
    where tipo in ('Total','Programado'))                 as ainda_como_Total_deve_ser_0;


-- ---------------------------------------------------------------------
-- BLOCO 5 — VERIFY funcional: o filtro da tela volta a funcionar?
-- A tela carrega UM MÊS por vez, então o teste é por mês.
-- Esperado: filtravel_por_natureza ≈ total_no_mes em TODOS os meses
-- (a diferença são só os pedidos sem valor lançado).
-- Antes do fix: jun/jul/ago devolviam 0 de 233 / 0 de 214 / 0 de 214.
-- ---------------------------------------------------------------------
select to_char(data_pedido,'YYYY-MM') as mes,
       count(*) as total_no_mes,
       count(*) filter (where tipo in ('Produto','Serviço','Misto')) as filtravel_por_natureza,
       count(*) filter (where tipo is null)                          as sem_valor_lancado
from public.compras_pedidos
where data_pedido >= '2026-04-01'
group by 1 order by 1;


-- ---------------------------------------------------------------------
-- ROLLBACK
-- Não há "estado anterior" a restaurar coluna a coluna: o valor antigo era
-- `Tipo` do Alvo, que é recuperável a qualquer momento porque não se perde nada
-- — está em compras_pedidos_auditoria.resposta_alvo->>'Tipo' (4.746 leituras).
-- Se for preciso desfazer:
--   update public.compras_pedidos p set tipo = a.tipo_alvo
--     from (select distinct on (ca.pedido_id) ca.pedido_id,
--                  ca.resposta_alvo->>'Tipo' as tipo_alvo
--             from public.compras_pedidos_auditoria ca
--            where ca.resposta_alvo ? 'Tipo'
--            order by ca.pedido_id, ca.created_at desc) a
--    where a.pedido_id = p.id;
-- Mas isso restaura o DEFEITO. Só faz sentido se o backfill for julgado errado.
-- ---------------------------------------------------------------------
