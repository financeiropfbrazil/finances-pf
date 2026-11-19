-- NFE-6 — rollback: tira a RPC do download de controle das etapas. Só com ordem do Pedro.
-- ⚠️ Antes, tirar (ou não publicar) o botão "Baixar Excel" da tela de Notas Fiscais — sem a RPC ele dá erro.
drop function public.nfe_relatorio_etapas(date, date);
