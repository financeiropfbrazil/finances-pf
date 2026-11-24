-- =====================================================================
-- LP-ENV A — Data do envio para aprovação do pedido (Pedro, 24/11/2026: "Sim, pode começar o 1")
-- Projeto: hbtggrbauguukewiknew.
-- Problema: o Alvo só informa "Enviou Aprovação" = Sim/Não (campo personalizado UserEnviouAprovacao), sem data. Nenhum
--   campo do pedido traz a data do envio (conferido no objeto completo do PedComp: só datas de digitação, pedido,
--   cadastro, validade, entrega e, no item, a da aprovação final). O "UserDataNotificao" NÃO é o envio: em 0 de 123
--   envios feitos pelo botão do Hub ele caiu perto da hora do envio (56 vezes depois da aprovação).
-- Solução:
--   1. Colunas enviado_aprovacao_em + enviado_aprovacao_origem em compras_pedidos:
--        botao_hub   = hora exata do botão "Enviar para aprovação" do Hub;
--        leitura     = hora em que o Hub leu o pedido já enviado (teto; com a Edge LP-ENV B, ≤ 1 h) — se a aprovação
--                      final é anterior, vale a data da aprovação (teto mais justo);
--        aproximado  = passado reconstituído pela auditoria do Hub (atraso: mediana 7 h, p90 54 h) ou pedido que já
--                      chegou ao Hub enviado;
--        desconhecido = enviado antes de 23/05/2026 (início da auditoria) ou sem transição registrada — fica sem data.
--   2. Passado: 118 exatos (auditoria 'enviado_aprovacao'), 914 aproximados (primeira leitura que viu sair de "Nenhum"),
--      1.364 desconhecidos (medido em 24/11/2026).
--   3. Gatilho BEFORE INSERT/UPDATE: quando o pedido passa a enviado (enviou_aprovacao='Sim' ou status_aprovacao ≠
--      'Nenhum' ou aprovado Total/Parcial) e ainda não tem data nem origem, carimba now() (ou a data da aprovação
--      final, se anterior). Pega TODO escritor: cron de compras, open-load da tela, botão do Hub, Projetos.
--   4. sync_runs aceita job_type 'envio_aprovacao' (Edge LP-ENV B).
-- Ordem importa: o passado é preenchido ANTES do gatilho existir (senão a próxima leitura carimbaria "agora" em
--   pedidos enviados há meses).
-- Rollback: LP-ENV-A-envio-aprovacao-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or (select count(*) from information_schema.tables where table_schema = 'public'
          and table_name in ('compras_pedidos', 'compras_requisicoes', 'compras_pedidos_emails_log')) <> 3 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'compras_pedidos'
             and column_name in ('enviado_aprovacao_em', 'enviado_aprovacao_origem')) then
    raise exception 'LP-ENV A já aplicada';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.compras_pedidos'::regclass and not tgisinternal) then
    raise exception 'compras_pedidos ganhou gatilho desde 24/11 — conferir antes';
  end if;
end $$;

-- 1. Colunas
alter table public.compras_pedidos
  add column enviado_aprovacao_em timestamptz,
  add column enviado_aprovacao_origem text
    constraint ck_compras_pedidos_envio_aprov_origem
    check (enviado_aprovacao_origem in ('botao_hub', 'leitura', 'aproximado', 'desconhecido'));

comment on column public.compras_pedidos.enviado_aprovacao_em is
  'LP-ENV (PLANO-PEDIDOS): quando o pedido foi enviado para aprovação. O Alvo não guarda essa data; a origem diz a precisão.';
comment on column public.compras_pedidos.enviado_aprovacao_origem is
  'botao_hub = exata (botão do Hub) · leitura = hora em que o Hub viu o pedido enviado (teto; ≤1 h com a Edge pedidos-envio-aprovacao-cron) · aproximado = reconstituído da auditoria ou pedido que já chegou enviado · desconhecido = enviado antes de 23/05/2026, sem data.';

-- 2. Passado (antes do gatilho)
with enviados as (
  select p.id, p.data_aprovacao_alvo
  from public.compras_pedidos p
  where p.enviou_aprovacao = 'Sim' or coalesce(p.status_aprovacao, 'Nenhum') <> 'Nenhum' or p.aprovado in ('Total', 'Parcial')
), botao as (
  select a.pedido_id, min(a.created_at) as em
  from public.compras_pedidos_auditoria a
  where a.evento = 'enviado_aprovacao' and a.sucesso
  group by 1
), leitura as (
  select a.pedido_id, min(a.created_at) as em
  from public.compras_pedidos_auditoria a
  where a.evento = 'sync_status'
    and coalesce(a.status_aprovacao_anterior, 'Nenhum') = 'Nenhum'
    and coalesce(a.status_aprovacao_novo, 'Nenhum') <> 'Nenhum'
  group by 1
), alvo as (
  select e.id,
         case when b.em is not null then b.em
              when l.em is not null then least(l.em, coalesce(e.data_aprovacao_alvo, l.em))
         end as em,
         case when b.em is not null then 'botao_hub'
              when l.em is not null then 'aproximado'
              else 'desconhecido'
         end as origem
  from enviados e
  left join botao b on b.pedido_id = e.id
  left join leitura l on l.pedido_id = e.id
)
update public.compras_pedidos p
   set enviado_aprovacao_em = a.em, enviado_aprovacao_origem = a.origem
  from alvo a
 where p.id = a.id;

-- 3. Gatilho
create function public.compras_pedidos_carimbar_envio_aprovacao()
returns trigger
language plpgsql
set search_path = public
as $$
-- LP-ENV (PLANO-PEDIDOS): carimba o envio para aprovação na 1ª escrita em que o pedido aparece enviado.
-- Quem grava a data explicitamente (botão do Hub, Edge pedidos-envio-aprovacao-cron) passa na frente.
begin
  if new.enviado_aprovacao_em is null and new.enviado_aprovacao_origem is null
     and (new.enviou_aprovacao = 'Sim'
          or coalesce(new.status_aprovacao, 'Nenhum') <> 'Nenhum'
          or new.aprovado in ('Total', 'Parcial')) then
    new.enviado_aprovacao_em := least(now(), coalesce(new.data_aprovacao_alvo, now()));
    new.enviado_aprovacao_origem := case when tg_op = 'INSERT' then 'aproximado' else 'leitura' end;
  end if;
  return new;
end;
$$;

revoke execute on function public.compras_pedidos_carimbar_envio_aprovacao() from public, anon, authenticated;

create trigger trg_compras_pedidos_envio_aprovacao
  before insert or update on public.compras_pedidos
  for each row execute function public.compras_pedidos_carimbar_envio_aprovacao();

-- 4. sync_runs aceita a Edge nova
alter table public.sync_runs
  drop constraint sync_runs_job_type_check,
  add constraint sync_runs_job_type_check check (job_type = any (array[
    'requisicoes', 'pedidos', 'bicephalous', 'despesas', 'docfin_despesas', 'nfe', 'intercompany', 'lote', 'produtos',
    'laudos', 'reqmat', 'estoque', 'parcelas_pagar', 'nfse_adn', 'nf_saida', 'envio_aprovacao']::text[]));
