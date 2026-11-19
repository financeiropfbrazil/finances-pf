-- NFSE-1.15 — rollback: tira a RPC do download de controle das etapas. Só com ordem do Pedro.
-- ⚠️ Antes, tirar (ou não publicar) o botão "Baixar Excel" da tela de Notas de Serviço — sem a RPC ele dá erro.
drop function public.nfse_relatorio_etapas(date, date);
