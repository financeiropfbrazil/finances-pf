-- =====================================================================
-- NFSE-0.2 — ROLLBACK: remove nfse_adn_doc, o gatilho e as duas funções.
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Só com ordem do Pedro.
--
-- Os dados da tabela são recuperáveis (o ADN entrega tudo de novo a partir do
-- NSU 1), mas a trava abaixo impede apagar sem querer depois da drenagem:
-- com linhas na tabela, troque v_pode_apagar_linhas para true e rode de novo.
-- Antes: confirmar que a Edge nfse-adn-sonda não está rodando (sync_runs aberto).
-- =====================================================================

begin;

do $$
declare
  v_pode_apagar_linhas constant boolean := false;
  v_linhas bigint;
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or to_regclass('public.intercompany_invoices_master_blocos_manual') is null then
    raise exception 'PRÉ-VOO: este banco não parece o Financial Hub (hbtggrbauguukewiknew). Nada foi alterado.';
  end if;
  if to_regclass('public.nfse_adn_doc') is null then
    raise exception 'nfse_adn_doc não existe — nada a desfazer.';
  end if;
  select count(*) into v_linhas from public.nfse_adn_doc;
  if v_linhas > 0 and not v_pode_apagar_linhas then
    raise exception 'nfse_adn_doc tem % linhas. Para apagar mesmo assim, troque v_pode_apagar_linhas para true.', v_linhas;
  end if;
end $$;

drop trigger if exists nfse_adn_doc_extrair on public.nfse_adn_doc;
drop table public.nfse_adn_doc;
drop function public.nfse_adn_doc_extrair();
drop function public.nfse_adn_xp(xml, text);

do $$
begin
  if to_regclass('public.nfse_adn_doc') is not null
     or to_regprocedure('public.nfse_adn_xp(xml,text)') is not null
     or to_regprocedure('public.nfse_adn_doc_extrair()') is not null then
    raise exception 'ROLLBACK: sobrou objeto da NFSE-0.2. Transação desfeita.';
  end if;
end $$;

commit;
