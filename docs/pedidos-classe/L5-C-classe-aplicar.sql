-- =====================================================================
-- L5-C — classe dos pedidos lidos antes do card C3, recuperada da auditoria do sync (PLANO-PEDIDOS.md) — 30/10/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (30/10): "Sim, pode executar o item 2 como sugeriu".
--
-- Problema: 444 pedidos terminais (Encerrado/Cancelado/Cancelado Parcial) da 1.01 estão sem classe no Hub
--   (classe_rec_desp nula e classe_rateio vazio). No Alvo todo pedido tem classe.
-- Causa: até 20/08/2026 (card C3, commit 050e88f) o sync-compras-status-cron gravava os detalhes sem a classe; pedido
--   terminal com detalhes_carregados=true sai da fila do cron e nunca mais é relido.
-- Fonte: a resposta do próprio Alvo (PedComp/Load) que o cron gravou em compras_pedidos_auditoria (evento sync_status) —
--   a mais recente de cada pedido que traz classe. 417 dos 444 têm (respostas de 27/05 a 20/08).
-- O que grava: SÓ os dois campos vazios, no formato que o cron grava hoje:
--   classe_rateio   = montarClasseRateioJsonb(alvo): PedCompClasseRecDespChildList → {classe, valor, percentual, centrosCusto}
--   classe_rec_desp = rateios[0].classe: a 1ª classe do 1º item não cancelado (senão a 1ª do cabeçalho)
--   Nunca sobrescreve campo preenchido. Não chama o Alvo, não mexe no cron, não toca status (e-mails = scan de status).
--   compras_pedidos não tem gatilho. O rateio relacional por item (compras_pedidos_itens_rateio) fica como está.
-- Backup: zz_bkp_pedidos_classe_20261030 (antes e depois de cada pedido). Rollback: L5-C-classe-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from information_schema.tables where table_schema = 'public'
        and table_name in ('compras_pedidos', 'compras_requisicoes', 'compras_pedidos_emails_log')) <> 3
     or (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regclass('public.zz_bkp_pedidos_classe_20261030') is not null then
    raise exception 'zz_bkp_pedidos_classe_20261030 já existe — L5-C já aplicado? Conferir antes.';
  end if;
end $$;

create table public.zz_bkp_pedidos_classe_20261030 as
with alvo as (
  select cp.id, cp.numero, cp.status, cp.classe_rec_desp, cp.classe_rateio, cp.updated_at
  from public.compras_pedidos cp
  where cp.codigo_empresa_filial = '1.01'
    and cp.status in ('Encerrado', 'Cancelado', 'Cancelado Parcial')
    and coalesce(cp.status_local::text, '') <> 'excluido_alvo'
    and cp.classe_rec_desp is null
    and (cp.classe_rateio is null or jsonb_typeof(cp.classe_rateio) <> 'array' or jsonb_array_length(cp.classe_rateio) = 0)
), fonte as (
  select distinct on (a.id) a.*, au.id as auditoria_id, au.created_at as resposta_em, au.resposta_alvo as r
  from alvo a
  join public.compras_pedidos_auditoria au on au.pedido_id = a.id and au.evento = 'sync_status'
   and jsonb_typeof(au.resposta_alvo) = 'object'
   and jsonb_typeof(au.resposta_alvo -> 'PedCompClasseRecDespChildList') = 'array'
   and jsonb_array_length(au.resposta_alvo -> 'PedCompClasseRecDespChildList') > 0
  order by a.id, au.created_at desc
)
select f.id, f.numero, f.status, f.auditoria_id, f.resposta_em,
       f.classe_rec_desp as classe_rec_desp_antes,
       f.classe_rateio   as classe_rateio_antes,
       f.updated_at      as updated_at_antes,
       coalesce(
         (select c ->> 'CodigoClasseRecDesp'
            from jsonb_array_elements(coalesce(f.r -> 'ItemPedCompChildList', '[]'::jsonb)) with ordinality it(item, i),
                 jsonb_array_elements(coalesce(it.item -> 'ItemPedCompClasseRecdespChildList', '[]'::jsonb)) with ordinality cl(c, j)
           where coalesce(it.item ->> 'Cancelado', '') <> 'Total' and coalesce(c ->> 'CodigoClasseRecDesp', '') <> ''
           order by it.i, cl.j limit 1),
         f.r -> 'PedCompClasseRecDespChildList' -> 0 ->> 'CodigoClasseRecDesp') as classe_rec_desp_nova,
       (select jsonb_agg(jsonb_build_object(
                 'classe', c -> 'CodigoClasseRecDesp',
                 'valor', c -> 'Valor',
                 'percentual', c -> 'Percentual',
                 'centrosCusto', (select coalesce(jsonb_agg(jsonb_build_object(
                                            'codigo', x -> 'CodigoCentroCtrl',
                                            'valor', x -> 'Valor',
                                            'percentual', x -> 'Percentual') order by k), '[]'::jsonb)
                                    from jsonb_array_elements(coalesce(c -> 'RateioPedCompChildList', c -> 'RateioItemPedCompChildList', '[]'::jsonb))
                                         with ordinality cc(x, k)))
               order by o)
          from jsonb_array_elements(f.r -> 'PedCompClasseRecDespChildList') with ordinality h(c, o)) as classe_rateio_nova
from fonte f;

comment on table public.zz_bkp_pedidos_classe_20261030 is
  'L5-C (PLANO-PEDIDOS, 30/10/2026): antes/depois da classe recuperada da auditoria. Fechada. Apagar depois de validado.';
alter table public.zz_bkp_pedidos_classe_20261030 enable row level security;
revoke all on table public.zz_bkp_pedidos_classe_20261030 from public, anon, authenticated;

do $$
declare
  v_bkp int;
  v_upd int;
begin
  select count(*) into v_bkp from public.zz_bkp_pedidos_classe_20261030;
  if v_bkp < 400 or v_bkp > 450 then
    raise exception 'Esperado ~417 pedidos, veio %. Transação desfeita.', v_bkp;
  end if;
  if exists (select 1 from public.zz_bkp_pedidos_classe_20261030
              where classe_rec_desp_nova is null or classe_rateio_nova is null or jsonb_array_length(classe_rateio_nova) = 0) then
    raise exception 'Algum pedido ficaria sem classe nova. Transação desfeita.';
  end if;
  if exists (select 1 from public.zz_bkp_pedidos_classe_20261030 b
              where not exists (select 1 from public.classes_rec_desp k where k.codigo = b.classe_rec_desp_nova)) then
    raise exception 'Classe nova fora do cadastro de classes. Transação desfeita.';
  end if;

  update public.compras_pedidos cp
     set classe_rec_desp = b.classe_rec_desp_nova,
         classe_rateio   = b.classe_rateio_nova,
         updated_at      = now()
    from public.zz_bkp_pedidos_classe_20261030 b
   where cp.id = b.id
     and cp.classe_rec_desp is null
     and (cp.classe_rateio is null or jsonb_typeof(cp.classe_rateio) <> 'array' or jsonb_array_length(cp.classe_rateio) = 0);
  get diagnostics v_upd = row_count;

  if v_upd <> v_bkp then
    raise exception 'Atualizou % de % pedidos. Transação desfeita.', v_upd, v_bkp;
  end if;
  raise notice 'L5-C: % pedidos com classe recuperada.', v_upd;
end $$;
