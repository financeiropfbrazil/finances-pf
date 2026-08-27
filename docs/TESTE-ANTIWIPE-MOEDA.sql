-- =====================================================================
-- TESTE ANTI-WIPE — moeda do pedido (MOEDA-PEDIDOS, cards A2/A3)
-- Preparado em 26/08/2026 para rodar apos um ciclo completo do cron
-- com o Alvo respondendo (horario comercial).
-- =====================================================================
--
-- O QUE ESTE TESTE PROVA
-- Que os dois pontos list-based do A2 (Job 3 da descoberta e o mapPedido
-- do frontend) realmente OMITEM as colunas de moeda, em vez de gravar
-- null por cima do que o Load ja tinha escrito.
--
-- POR QUE NAO BASTA COMPARAR CONTAGENS
-- O bucket se move sozinho a cada ciclo: o completarCamposAusentes
-- preenche a moeda dos vivos de hora em hora, e pedido novo entra sem
-- moeda. Entre 26/08 21h e 27/08 00h o sem-moeda ja caiu de 256 para 247
-- e o USD de 17 para 16, sem nenhuma intervencao. Portanto:
--   · numero de BRL/USD/EUR SUBINDO   = cron trabalhando, esperado;
--   · numero DESCENDO                 = pode ser reclassificacao legitima
--                                       (pedido que ganhou moeda estrangeira);
--   · MOEDA VOLTANDO A NULL           = wipe. So isto e inequivoco.
--
-- A FONTE DE VERDADE E O AUDIT
-- `compras_pedidos_auditoria` com evento 'sync_status' guarda o payload do
-- Load completo, e a tabela e append-only (card B4 revogou UPDATE/DELETE).
-- O cron NAO consegue reescrever o audit. Entao o audit funciona como
-- snapshot imutavel do que o Alvo ja afirmou — sem precisar criar ancora.
--
-- Confirmado no codigo: o audit 'sync_status' e gravado logo APOS o upsert
-- bem-sucedido, dentro do mesmo bloco `mudou`. Se a moeda mudar de verdade
-- no ERP, `moedaMudou` liga o gate e tabela e audit avancam JUNTOS — por
-- isso o W2 abaixo nao produz falso positivo em mudanca legitima.
--
-- BASELINE MEDIDA EM 26/08/2026 ~23h UTC, ANTES DO CICLO:
--   pedidos_com_moeda_provada_no_audit = 840
--   W1 = 0   W2 = 0   W3 = 0
-- Amanha, qualquer um dos tres acima de zero e regressao.
--
-- LIMITE CONHECIDO deste teste: ele cobre os 840 pedidos cuja moeda esta
-- PROVADA em audit. Pedido que so recebeu moeda pelo completarCamposAusentes
-- e nunca gerou audit com moeda nao entra no conjunto. Isso nao invalida o
-- teste — os 840 sao exatamente o alvo do backfill do A3, que e o que
-- estamos protegendo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 1 — O VEREDITO. Roda os tres testes de uma vez.
-- SUCESSO = W1, W2 e W3 todos ZERO.
-- ---------------------------------------------------------------------
with fonte as (
  select distinct on (ca.pedido_id)
         ca.pedido_id,
         ca.resposta_alvo->>'CodigoIndEconomico' as ind_audit
  from public.compras_pedidos_auditoria ca
  where ca.evento = 'sync_status'
    and ca.resposta_alvo->>'CodigoIndEconomico' is not null
  order by ca.pedido_id, ca.created_at desc
)
select
  (select count(*) from fonte)                                as pedidos_com_moeda_provada_no_audit,
  (select count(*) from public.compras_pedidos p
     join fonte f on f.pedido_id = p.id
     where p.codigo_ind_economico is null)                    as w1_moeda_perdida,
  (select count(*) from public.compras_pedidos p
     join fonte f on f.pedido_id = p.id
     where p.codigo_ind_economico is not null
       and p.codigo_ind_economico is distinct from f.ind_audit) as w2_moeda_divergente,
  (select count(*) from public.compras_pedidos p
     join fonte f on f.pedido_id = p.id
     where p.codigo_ind_economico is not null
       and p.valor_cambio is null)                            as w3_cambio_perdido;


-- ---------------------------------------------------------------------
-- BLOCO 2 — W1 nominal: QUAIS pedidos perderam a moeda.
-- So rode se o Bloco 1 acusou w1 > 0. Zero linhas = tudo certo.
-- `synced_at` e `updated_at` dizem QUANDO o cron passou por ali, que e o
-- que liga o wipe ao ciclo que o causou.
-- ---------------------------------------------------------------------
with fonte as (
  select distinct on (ca.pedido_id)
         ca.pedido_id,
         ca.resposta_alvo->>'CodigoIndEconomico' as ind_audit,
         ca.created_at as audit_em
  from public.compras_pedidos_auditoria ca
  where ca.evento = 'sync_status'
    and ca.resposta_alvo->>'CodigoIndEconomico' is not null
  order by ca.pedido_id, ca.created_at desc
)
select p.numero, p.nome_entidade, p.valor_total,
       f.ind_audit          as moeda_que_o_alvo_ja_afirmou,
       p.codigo_ind_economico as moeda_agora,
       p.valor_cambio, f.audit_em, p.synced_at, p.updated_at, p.status_local
from public.compras_pedidos p
join fonte f on f.pedido_id = p.id
where p.codigo_ind_economico is null
order by p.updated_at desc;


-- ---------------------------------------------------------------------
-- BLOCO 3 — W2 nominal: moeda DIFERENTE da que o audit mais recente diz.
-- Zero linhas = tudo certo. Linha aqui NAO e automaticamente corrupcao:
-- confira `audit_em` contra `updated_at`. Se o pedido foi atualizado
-- DEPOIS do audit, pode ser mudanca real no ERP que ainda nao gerou audit
-- novo. Se `updated_at` for anterior, ai e corrupcao.
-- ---------------------------------------------------------------------
with fonte as (
  select distinct on (ca.pedido_id)
         ca.pedido_id,
         ca.resposta_alvo->>'CodigoIndEconomico' as ind_audit,
         ca.created_at as audit_em
  from public.compras_pedidos_auditoria ca
  where ca.evento = 'sync_status'
    and ca.resposta_alvo->>'CodigoIndEconomico' is not null
  order by ca.pedido_id, ca.created_at desc
)
select p.numero, p.nome_entidade,
       f.ind_audit as moeda_no_audit, p.codigo_ind_economico as moeda_na_tabela,
       f.audit_em, p.updated_at,
       case when p.updated_at > f.audit_em
            then 'atualizado depois do audit - pode ser mudanca real'
            else 'CORRUPCAO: tabela diverge sem atualizacao posterior'
       end as leitura
from public.compras_pedidos p
join fonte f on f.pedido_id = p.id
where p.codigo_ind_economico is not null
  and p.codigo_ind_economico is distinct from f.ind_audit
order by p.updated_at desc;


-- ---------------------------------------------------------------------
-- BLOCO 4 — Os dois cobaias, conferencia direta.
-- Esperado: ambos '0000002', cambio 5.1211 (0004564) e 5.0733 (0004568).
-- Se a moeda sumir aqui, o wipe pegou o caso mais visitado da base.
-- ---------------------------------------------------------------------
select numero, nome_entidade, valor_total, codigo_ind_economico, valor_cambio,
       synced_at, updated_at
from public.compras_pedidos
where numero in ('0004564','0004568')
order by numero;


-- ---------------------------------------------------------------------
-- BLOCO 5 — Contexto: o Bloco 4 da sessao anterior, para comparar.
-- Referencia de 26/08 (nao e esperado fixo — os numeros SOBEM com o cron):
--   (sem moeda) 1127 | 0000001: 791 | 0000002: 39 | 0000003: 10
--   sem_cambio = 0 nas tres moedas
-- ---------------------------------------------------------------------
select coalesce(codigo_ind_economico,'(sem moeda)') as moeda,
       count(*) as pedidos,
       count(*) filter (where valor_cambio is null) as sem_cambio
from public.compras_pedidos
group by 1
order by 1;


-- ---------------------------------------------------------------------
-- BLOCO 6 — Prova de que o ciclo REALMENTE rodou com o Alvo respondendo.
-- Sem isto, W1=0 pode significar apenas que o cron nao processou nada
-- (foi o que aconteceu em 26/08 as 22:41: 152 erros, MUDARAM 0, o Alvo
-- devolvendo 404 HTML na autenticacao). Um teste anti-wipe sobre um ciclo
-- que nao rodou nao prova nada.
-- ---------------------------------------------------------------------
select started_at, job_type, total_erros,
       left(coalesce(observacao,''), 160) as observacao
from public.sync_runs
where job_type = 'bicephalous'
  and started_at > now() - interval '24 hours'
order by started_at desc
limit 10;
