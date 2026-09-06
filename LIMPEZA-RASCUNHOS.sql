-- LIMPEZA-RASCUNHOS.sql
-- NAO EXECUTADO. Este arquivo e um roteiro para o Pedro colar no SQL editor do Supabase.
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Confirme o projeto antes de colar.
--
-- ESCOPO: apaga APENAS os 14 rascunhos-lixo gerados pelo bug do upload_identify_guid_key
-- a partir de 2026-09-02. Medidos em 2026-09-06 14:41 UTC: os 14 tem numero_alvo null,
-- status 'rascunho', ZERO anexos, ZERO eventos de auditoria e ZERO linhas de rateio --
-- so itens (1 ou 3 por requisicao). Sao tentativas repetidas da mesma requisicao, sem conteudo unico.
--
-- FORA DO ESCOPO 1 -- ERRO DE LOGIN: os 6 rascunhos com erro
-- "Seu usuário não tem login do ERP Alvo configurado" NAO entram nesta limpeza.
-- Eles tem anexo e conteudo reais (5 dos 6 com 1 anexo cada, todos com 1 evento de auditoria)
-- e serao REENVIADOS pela tela depois do fix. Apagar esses 6 seria perda de trabalho do usuario.
-- A clausula WHERE abaixo ja os exclui pelo filtro de erro_ultimo_envio.
--
-- FORA DO ESCOPO 2 -- OUTLIER DE MAIO: existe 1 rascunho com o MESMO erro de GUID criado em
-- 2026-05-18 12:15:12 UTC (id 46b68561-da7f-4d11-afa3-0f6bb67d9119), o que faz o grupo GUID
-- somar 15 e nao 14. Ele tem 1 evento de auditoria e e de outro episodio, meses antes.
-- A trava created_at >= '2026-09-02' o exclui de proposito. NAO remova essa trava:
-- sem ela o DELETE apagaria 15 linhas em vez de 14.
--
-- FKs VERIFICADAS em 2026-09-06 (nao presumidas): as 4 tabelas filhas de compras_requisicoes
-- -- compras_requisicoes_itens, compras_requisicoes_arquivos, compras_requisicoes_rateio_classes
-- e compras_requisicoes_auditoria -- TODAS tem FK com ON DELETE CASCADE.
-- Portanto NAO e preciso apagar filhos antes: o DELETE no pai limpa os filhos sozinho
-- e nao vai falhar por violacao de FK.
-- Os NETOS tambem cascateiam (conferido pelo coordenador em 2026-09-06):
-- compras_requisicoes_itens_classe_rec_desp -> compras_requisicoes_itens (CASCADE) e
-- compras_requisicoes_rateio_cc -> compras_requisicoes_rateio_classes (CASCADE).
-- A cadeia inteira cai junto; nenhuma tabela do modulo bloqueia o DELETE no pai.
--
-- ROLLBACK: enquanto a transacao estiver aberta, ROLLBACK; desfaz tudo.
-- Depois do COMMIT nao ha volta -- por isso a conferencia do bloco 2 e obrigatoria.


-- BLOCO 1 -- abre a transacao. Rode sozinho, antes de tudo.
BEGIN;


-- BLOCO 2 -- CONFERENCIA. Mesma clausula WHERE do DELETE, sem apagar nada.
-- Liste e CONTE as linhas. O esperado e 14 linhas, todas com status 'rascunho',
-- numero_alvo null, anexos = 0 e auditoria = 0.
-- Se vier numero diferente de 14, ou alguma linha com anexos > 0, PARE e de ROLLBACK;
select
  r.id,
  r.created_at at time zone 'UTC' as created_utc,
  r.status,
  r.numero_alvo,
  r.requisitante_user_id,
  left(coalesce(r.descricao,''), 60) as descricao,
  r.total_itens,
  (select count(*) from compras_requisicoes_itens i where i.requisicao_id = r.id) as itens,
  (select count(*) from compras_requisicoes_arquivos a where a.requisicao_id = r.id) as anexos,
  (select count(*) from compras_requisicoes_auditoria x where x.requisicao_id = r.id) as auditoria,
  (select count(*) from compras_requisicoes_rateio_classes c where c.requisicao_id = r.id) as rateio,
  left(r.erro_ultimo_envio, 60) as erro
from compras_requisicoes r
where r.numero_alvo is null
  and r.status = 'rascunho'
  and r.erro_ultimo_envio like '%upload_identify_guid_key%'
  and r.created_at >= '2026-09-02'
order by r.created_at;


-- BLOCO 3 -- o DELETE. Os filhos caem por ON DELETE CASCADE.
-- O RETURNING devolve uma linha por requisicao apagada: CONTE essas linhas.
delete from compras_requisicoes
where numero_alvo is null
  and status = 'rascunho'
  and erro_ultimo_envio like '%upload_identify_guid_key%'
  and created_at >= '2026-09-02'
returning id, created_at, erro_ultimo_envio;


-- BLOCO 4 -- DECISAO. Leia antes de rodar.
-- So de COMMIT se a contagem de linhas do RETURNING (bloco 3) for EXATAMENTE IGUAL
-- a contagem de linhas do SELECT de conferencia (bloco 2) -- o esperado e 14 e 14.
-- Se os numeros divergirem, ou se o RETURNING trouxer algum id que nao aparecia no bloco 2,
-- rode ROLLBACK; em vez de COMMIT e reporte antes de tentar de novo.
COMMIT;


-- BLOCO 5 -- alternativa ao bloco 4, para o caso de divergencia. Desfaz tudo.
-- ROLLBACK;
