-- NFSE-1.16 — rollback: tira a RPC e as duas tabelas do de/para do Questor. Só com ordem do Pedro.
-- ⚠️ Antes, tirar (ou não publicar) o botão "Excel p/ contabilidade" da tela de Notas de Serviço — sem a RPC ele dá erro.
-- Para só corrigir o de/para, NÃO rodar isto: update/insert em questor_natureza_classe por prompt.
drop function public.nfse_relatorio_questor(date, date);
drop table public.questor_natureza_classe;
drop table public.questor_natureza;
