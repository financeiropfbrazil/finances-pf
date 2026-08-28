-- =====================================================================
-- §14.4 — DESBLOQUEIO do envio de requisições depois da regra D-17
-- Preparado em 28/08/2026. Pedro executa no SQL Editor.
-- =====================================================================
--
-- ⛔ ESTE SQL É PRÉ-REQUISITO DO **PUBLISH**, NÃO DO PUSH.
--
-- O commit `c6984e1` faz o envio de requisição PARAR quando quem opera não tem
-- `profiles.alvo_usuario` — a regra D-17, já em produção no módulo de Projetos:
-- sem identidade própria, falha com mensagem clara; nunca usa a identidade de
-- outra pessoa. Push atualiza só o preview do Lovable; o app publicado só muda
-- com o Publish manual. O bloqueio está exatamente aí.
--
-- 🔴 EXPOSIÇÃO MEDIDA (MCP, 28/08/2026 10:5x UTC):
--   · 32 pessoas já enviaram requisição ao ERP pelo Hub (226 payloads).
--   · Apenas **2** têm `alvo_usuario`: pedro.scrignoli e ana.sanches.
--   · As outras **30** respondem por **197 dos 226 envios (87%)** e TODAS
--     tiveram envio nos últimos 90 dias.
--   ⇒ Publicar sem preencher os logins PARA o módulo de requisições para 30
--     pessoas. Não é hipótese: é a lista do BLOCO 1.
--
-- 🔴 NUNCA DEDUZIR O LOGIN. Não existe regra determinística ligando nome,
--    e-mail ou `funcionario_alvo_codigo` ao login do Alvo: o Ryan tem
--    funcionário `0000063`, nome `ryan.santos` e login **`RYAN.PAGANOTTO`**
--    (PLANO-PROJETOS §A-9, cuidado 1). Deduzir gera identidade ERRADA no ERP —
--    exatamente o problema que a regra veio matar. **O Pedro confirma cada login
--    dentro do Alvo antes de gravar.**
--
-- ⚠️ DUAS SAÍDAS POSSÍVEIS — a decisão é do Pedro, e só uma precisa deste SQL:
--
--   (A) Cadastrar o login real de cada uma das 30 pessoas no Alvo e gravar aqui.
--       É o que a D-17 prescreve. Custo: 30 logins no ERP (os que ainda não
--       existirem) + este UPDATE. Depois disso o ERP passa a registrar quem
--       realmente operou.
--
--   (B) Criar UM login de serviço no Alvo (ex.: `HUB.SUPRIMENTOS`) e usá-lo como
--       identidade do gateway, em vez do login pessoal.
--       ⚠️ Isto **não contraria** a D-17: o que ela proíbe é emprestar a
--       identidade de uma PESSOA. É, aliás, o que a própria D-17 manda fazer com
--       a conta funcional `nfe@`: *"se um dia precisar enviar pedido, cria-se
--       primeiro um login no Alvo; nunca emprestar o de outra pessoa."*
--       Custo: 1 login. Perda: o ERP deixa de distinguir o operador por este
--       campo — mas ele **já não distingue hoje** (1 valor em 226 envios), e o
--       requisitante continua identificado por `CodigoFuncionario`, que tem
--       **34 códigos distintos** nos mesmos 226 envios.
--       ⚠️ (B) exige uma linha de código a mais (a constante de serviço como
--       último recurso, com log), que NÃO está implementada — o commit c6984e1
--       implementa (A). Peça se for esse o caminho.
--
--   ⛔ O que NÃO é opção: voltar a mandar `PEDRO.SCRIGNOLI` para todo mundo.
--
-- ⚠️ ESCOPO: só `profiles.alvo_usuario`. Não toca permissões, RLS, RPCs, nem
--    `funcionario_alvo_codigo`. A colisão do A-10 (`nfe@` e `pedro.scrignoli@`
--    compartilhando `funcionario_alvo_codigo = 0000149`, conferida hoje) é OUTRO
--    campo e OUTRO card — não mexer aqui.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 0 — PRÉ-VOO. Confirma o projeto ANTES de qualquer escrita.
-- ---------------------------------------------------------------------
select current_database()                                    as db,
       (select count(*) from public.compras_pedidos)          as fp_pedidos,
       (to_regclass('public.profiles') is not null)           as fp_profiles,
       now() at time zone 'UTC'                               as agora_utc;


-- ---------------------------------------------------------------------
-- BLOCO 1 — PREVIEW / LISTA DE TRABALHO. Não escreve nada.
-- Quem já enviou requisição e HOJE seria bloqueado. Ordem: quem mais envia
-- primeiro. `alvo_usuario_a_preencher` é a coluna que o Pedro completa
-- consultando o Alvo — NÃO deduzir a partir do e-mail.
-- ---------------------------------------------------------------------
with envios as (
  select a.user_id,
         count(*)                                                          as envios,
         count(*) filter (where a.created_at >= now() - interval '90 days') as envios_90d,
         max(a.created_at)::date                                           as ultimo_envio
  from public.compras_requisicoes_auditoria a
  where a.evento = 'envio_tentado'
    and a.payload_enviado is not null
    and a.user_id is not null
  group by 1
)
select p.email,
       p.full_name,
       p.funcionario_alvo_codigo,
       p.alvo_usuario                          as alvo_usuario_hoje,
       null::text                              as alvo_usuario_a_preencher,  -- ← Pedro confirma no Alvo
       e.envios,
       e.envios_90d,
       e.ultimo_envio
from envios e
join public.profiles p on p.user_id = e.user_id
where nullif(trim(p.alvo_usuario), '') is null
order by e.envios desc, p.email;
-- Esperado em 28/08/2026: 30 linhas. Se vierem menos, alguém já preencheu —
-- ótimo, e a contagem do BLOCO 3 confirma.


-- ---------------------------------------------------------------------
-- BLOCO 1b — CONTAGEM DE CONTROLE. O número que decide o Publish.
-- ---------------------------------------------------------------------
with envios as (
  select distinct a.user_id
  from public.compras_requisicoes_auditoria a
  where a.evento='envio_tentado' and a.payload_enviado is not null and a.user_id is not null
)
select count(*)                                                                  as remetentes_conhecidos,
       count(*) filter (where nullif(trim(p.alvo_usuario),'') is not null)        as com_login,
       count(*) filter (where nullif(trim(p.alvo_usuario),'') is null)            as bloqueados_hoje
from envios e join public.profiles p on p.user_id = e.user_id;
-- ⛔ PUBLICAR SÓ QUANDO `bloqueados_hoje` FOR 0 (ou quando o Pedro decidir
--    conscientemente quem fica de fora).


-- ---------------------------------------------------------------------
-- BLOCO 2 — APPLY. Idempotente (UPDATE por e-mail, valor final explícito).
--
-- 🔴 NÃO RODE COMO ESTÁ. Este bloco é um TEMPLATE: substitua cada
--    '<CONFIRMAR NO ALVO>' pelo login REAL, lido dentro do Alvo. Apague as
--    linhas de quem ainda não tiver login criado no ERP — é melhor a pessoa
--    ficar bloqueada com mensagem clara do que ir ao ERP com identidade errada.
--
-- O `where ... is distinct from` deixa o UPDATE idempotente: rodar duas vezes
-- não gera segunda escrita, e `linhas_afetadas` na segunda vez é 0.
-- ---------------------------------------------------------------------
-- begin;
--
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'guilherme.oliveira@pfbrazil.com' and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 37 envios
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'bianca.goncalves@pfbrazil.com'   and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 25
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'kemilly.araujo@pfbrazil.com'     and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 22
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'diego.amancio@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 17
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'isabela.catanoze@pfbrazil.com'   and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 7
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'jessica.teodoro@pfbrazil.com'    and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 7
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'anna.morais@pfbrazil.com'        and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 7
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'bharguan.nogueira@pfbrazil.com'  and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 6
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'gabriel.matos@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 6
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'poliane.negrao@pfbrazil.com'     and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 5
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'natalia.silva@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 5
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'hugo.maffei@pfbrazil.com'        and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 5
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'bianca.rangel@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 4
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'natalia.prioto@pfbrazil.com'     and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 4
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'maria.alves@pfbrazil.com'        and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 4
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'larissa.maraus@pfbrazil.com'     and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 4
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'hernandes.gomes@pfbrazil.com'    and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 3
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'laira.fogato@pfbrazil.com'       and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 3
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'tiago.pereira@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 3
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'tiago.carli@pfbrazil.com'        and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'maria.santos@pfbrazil.com'       and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'maria.silva@pfbrazil.com'        and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'erica.ferrari@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'rafaela.santos@pfbrazil.com'     and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'amabilla.marchini@pfbrazil.com'  and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'jessica.souza@pfbrazil.com'      and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'nathalia.richele@pfbrazil.com'   and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'maria.calastri@pfbrazil.com'     and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 2
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'guilherme.molinari@pfbrazil.com' and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 1
-- update public.profiles set alvo_usuario = '<CONFIRMAR NO ALVO>' where email = 'cleidinal.peruzzo@pfbrazil.com'  and alvo_usuario is distinct from '<CONFIRMAR NO ALVO>';  -- 1
--
-- commit;
--
-- ⚠️ Lote no SQL Editor pode falhar em silêncio (§2 item 10 do
--    ESTADO-REVISAO-SUPRIMENTOS: 14 revokes colados juntos não surtiram efeito
--    nenhum, sem mensagem de erro). Rode em blocos pequenos e confira o BLOCO 3
--    — o "Success" não é evidência.


-- ---------------------------------------------------------------------
-- BLOCO 3 — VERIFY. Remedindo na hora.
-- ---------------------------------------------------------------------
-- (3a) Quem ainda está bloqueado. Meta: 0 linhas (ou só quem o Pedro decidiu deixar).
with envios as (
  select a.user_id, count(*) as envios
  from public.compras_requisicoes_auditoria a
  where a.evento='envio_tentado' and a.payload_enviado is not null and a.user_id is not null
  group by 1
)
select p.email, p.full_name, e.envios, p.alvo_usuario
from envios e join public.profiles p on p.user_id = e.user_id
where nullif(trim(p.alvo_usuario), '') is null
order by e.envios desc;

-- (3b) Nenhum login pode estar repetido entre pessoas — repetir é o próprio
--      defeito voltando por outra porta (é a forma do A-10, no outro campo).
select alvo_usuario, count(*) as pessoas, string_agg(email, ', ' order by email) as emails
from public.profiles
where nullif(trim(alvo_usuario),'') is not null
group by 1 having count(*) > 1;
-- Esperado: 0 linhas.

-- (3c) Nenhum login com espaço sobrando ou caixa estranha (o Alvo é sensível).
select email, alvo_usuario
from public.profiles
where nullif(trim(alvo_usuario),'') is not null
  and (alvo_usuario <> trim(alvo_usuario) or alvo_usuario <> upper(alvo_usuario));
-- Esperado: 0 linhas. Se aparecer, confira no Alvo antes de "corrigir" a caixa —
-- não presuma que o login é maiúsculo só porque os 5 de hoje são.


-- =====================================================================
-- ROLLBACK — NÃO EXECUTAR. Só para guardar.
-- Devolve os 30 a NULL, isto é, volta a bloquear. NÃO devolve o comportamento
-- antigo (mandar PEDRO.SCRIGNOLI): isso é `git revert` do commit c6984e1.
-- =====================================================================
-- update public.profiles set alvo_usuario = null
--  where email in ('guilherme.oliveira@pfbrazil.com', /* … */);
