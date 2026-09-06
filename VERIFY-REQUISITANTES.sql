-- VERIFY-REQUISITANTES.sql
-- Rodar DEPOIS do Publish no Lovable E depois de um envio real de requisicao feito por
-- um usuario SEM a flag is_admin (o Pedro tem bypass; erro de permissao nunca aparece para ele).
-- Todas as consultas sao SOMENTE LEITURA.
-- Baseline medido em 2026-09-06 14:41 UTC (subagente D) esta anotado em cada bloco.


-- BLOCO 1
-- Prova: a trilha de auditoria escrita pelo FRONTEND voltou a gravar.
-- Baseline (2026-09-06 14:41 UTC): os quatro eventos estavam CONGELADOS --
--   criada        -> 2026-08-19 19:06:32 UTC (214 no total)
--   envio_tentado -> 2026-08-19 19:06:34 UTC (226 no total)
--   envio_sucesso -> 2026-08-19 19:06:36 UTC (202 no total)
--   envio_falha   -> 2026-07-31 11:47:44 UTC (19 no total)
-- ESPERADO DEPOIS DO FIX: 'criada', 'envio_tentado' e 'envio_sucesso' com ultimo_utc
-- na data/hora do teste (minutos atras), e total_geral maior que o baseline acima.
-- Se ultimo_utc continuar em 2026-08-19, a trilha do frontend AINDA esta morta.
select
  now() at time zone 'UTC' as medido_em_utc,
  evento,
  max(created_at) at time zone 'UTC' as ultimo_utc,
  count(*) as total_geral,
  count(*) filter (where created_at >= now() - interval '30 days') as ultimos_30d
from compras_requisicoes_auditoria
where evento in ('criada','envio_tentado','envio_sucesso','envio_falha')
group by evento
order by evento;


-- BLOCO 2
-- Prova: houve escrita de auditoria nas ultimas 24h (a trilha esta viva agora, nao so no passado).
-- Baseline (2026-09-06 14:41 UTC): ZERO eventos de frontend nas ultimas 24h.
-- ESPERADO DEPOIS DO FIX: pelo menos 1 linha, com 'criada' e 'envio_tentado' presentes
-- e, no caminho feliz, 'envio_sucesso' tambem. Resultado vazio = fix nao surtiu efeito.
select
  now() at time zone 'UTC' as medido_em_utc,
  evento,
  count(*) as eventos_24h,
  max(created_at) at time zone 'UTC' as ultimo_utc
from compras_requisicoes_auditoria
where created_at >= now() - interval '24 hours'
group by evento
order by eventos_24h desc, evento;


-- BLOCO 3
-- Prova: os rascunhos-lixo com erro de GUID pararam de crescer.
-- Baseline (2026-09-06 14:41 UTC): 15 no total, sendo 14 criados a partir de 2026-09-02
-- (o 15o e um outlier isolado de 2026-05-18 12:15 UTC, que a trava de data exclui).
-- Intervalo do grupo: 2026-05-18 12:15:12 UTC ate 2026-09-04 11:51:09 UTC.
-- ESPERADO DEPOIS DO FIX: total_desde_0209 continua 14 se a limpeza ainda nao rodou,
-- ou 0 se LIMPEZA-RASCUNHOS.sql ja foi aplicado. O que NAO pode acontecer e o numero
-- SUBIR e o ultimo_utc avancar para depois do Publish -- isso significa que o bug do
-- upload_identify_guid_key continua gerando lixo.
select
  now() at time zone 'UTC' as medido_em_utc,
  count(*) as total_grupo_guid,
  count(*) filter (where created_at >= '2026-09-02') as total_desde_0209,
  min(created_at) at time zone 'UTC' as primeiro_utc,
  max(created_at) at time zone 'UTC' as ultimo_utc
from compras_requisicoes
where erro_ultimo_envio like '%upload_identify_guid_key%';


-- BLOCO 4
-- Prova: os rascunhos travados por falta de login do ERP pararam de crescer.
-- Baseline (2026-09-06 14:41 UTC): 6 rascunhos, todos com numero_alvo null e status 'rascunho',
-- criados entre 2026-09-02 17:53:35 UTC e 2026-09-04 20:58:28 UTC.
-- ESPERADO DEPOIS DO FIX: total continua 6 e ultimo_utc continua 2026-09-04 20:58:28 UTC
-- (o grupo congela). Conforme os 6 forem reenviados pela tela, o total DIMINUI.
-- Numero subindo com ultimo_utc posterior ao Publish = o login de servico nao esta sendo usado.
select
  now() at time zone 'UTC' as medido_em_utc,
  count(*) as total_grupo_login,
  count(*) filter (where numero_alvo is null and status = 'rascunho') as ainda_travados,
  min(created_at) at time zone 'UTC' as primeiro_utc,
  max(created_at) at time zone 'UTC' as ultimo_utc
from compras_requisicoes
where erro_ultimo_envio like 'Seu usuário não tem login%';


-- BLOCO 5
-- Prova: o login de SERVICO aparece em CodigoUsuario/UsuarioLogado (a mesma credencial para
-- todo mundo, resolvendo o erro "Seu usuario nao tem login do ERP Alvo configurado") E,
-- ao mesmo tempo, CodigoFuncionario continua DISTINGUINDO as pessoas (nao virou constante).
-- Estrutura confirmada em 2026-09-06: as tres chaves ficam na RAIZ de payload_enviado.
-- Baseline (envios ate 2026-08-19): CodigoUsuario era sempre 'PEDRO.SCRIGNOLI' (o login do
-- usuario logado), enquanto CodigoFuncionario variava por pessoa (0000167, 0000150, 0000099, 0000163).
-- ESPERADO DEPOIS DO FIX: codigo_usuario = o login de servico, IGUAL em todas as linhas novas;
-- codigo_funcionario = o codigo da pessoa que de fato abriu a requisicao, DIFERENTE entre linhas
-- de requisitantes diferentes. Se codigo_funcionario virar constante, o ERP perdeu a rastreabilidade
-- de quem pediu -- isso e regressao, nao sucesso.
select
  a.created_at at time zone 'UTC' as created_utc,
  a.user_nome,
  a.payload_enviado->>'CodigoUsuario'     as codigo_usuario,
  a.payload_enviado->>'UsuarioLogado'     as usuario_logado,
  a.payload_enviado->>'CodigoFuncionario' as codigo_funcionario,
  a.sucesso,
  left(coalesce(a.mensagem_erro,''), 80) as erro
from compras_requisicoes_auditoria a
where a.evento = 'envio_tentado'
order by a.created_at desc
limit 20;


-- BLOCO 6
-- Prova: contagem de logins de servico distintos x funcionarios distintos nos envios pos-fix.
-- O corte 2026-08-19 19:07:00 UTC fica logo depois do ultimo envio_tentado do baseline
-- (2026-08-19 19:06:34.245924 UTC), entao esta consulta enxerga SO os envios novos.
-- Baseline (2026-09-06 14:44 UTC): envios_pos_publish = 0. Qualquer valor > 0 ja e envio novo.
-- ESPERADO: logins_distintos = 1 (o de servico, igual para todos) e funcionarios_distintos >= 2
-- assim que duas pessoas diferentes enviarem. Enquanto so uma pessoa tiver testado,
-- funcionarios_distintos = 1 e o resultado e INCONCLUSIVO -- e preciso um segundo requisitante,
-- e ele NAO pode ser o Pedro (unico is_admin de 52, tem bypass de permissao).
select
  now() at time zone 'UTC' as medido_em_utc,
  count(*) as envios_pos_publish,
  count(distinct payload_enviado->>'CodigoUsuario')     as logins_distintos,
  count(distinct payload_enviado->>'CodigoFuncionario') as funcionarios_distintos
from compras_requisicoes_auditoria
where evento = 'envio_tentado'
  and created_at >= '2026-08-19 19:07:00';
