-- =====================================================================
-- PROJ-L7B · b5 — profiles.alvo_usuario da Ana Sanches
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 12 (L7-B, item b5) · decisao D-17
--
-- ESTADO: PENDENTE de aplicacao.
--
-- O QUE DESTRAVA:
--   Com o L7-B (b2/b3/b4), o envio ao Alvo resolve o CodigoUsuario a partir de
--   profiles.alvo_usuario e BLOQUEIA quando esta nulo — de proposito: pedido no
--   ERP com identidade de outra pessoa e pior que pedido nao enviado (foi assim
--   que 2 pedidos foram parar no Alvo carimbados com o Pedro).
--   Enquanto esta linha nao rodar, a Ana continua bloqueada.
--
-- LOGIN CONFIRMADO PELO PEDRO no proprio Alvo (nao deduzido):
--   ana.sanches@pfbrazil.com  ->  ANA.SANCHES
--
--   ⚠️ Nao existe regra deterministica ligando nome/funcionario ao login:
--      o Ryan tem funcionario 0000063, nome "ryan.santos" e login
--      RYAN.PAGANOTTO. Deduzir gera identidade errada no ERP.
--
-- FORA DESTE SCRIPT — nfe@pfbrazil.com (D-17):
--   Conta FUNCIONAL (NF-e), nao pessoa, e sem login no Alvo. NAO preencher.
--   O bloqueio no envio e o comportamento correto para ela. Se um dia precisar
--   enviar pedido, cria-se antes um login no Alvo.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — DRY-RUN (nao persiste nada; rodar primeiro e conferir)
-- =====================================================================
begin;

-- ANTES
select 'ANTES' as momento, user_id, email, full_name, is_admin,
       alvo_usuario, funcionario_alvo_codigo
  from public.profiles
 where email = 'ana.sanches@pfbrazil.com';

-- aplica so para ver o efeito
update public.profiles
   set alvo_usuario = 'ANA.SANCHES'
 where email = 'ana.sanches@pfbrazil.com'
   and alvo_usuario is null;   -- guarda: nao sobrescreve valor existente

-- DEPOIS
select 'DEPOIS' as momento, user_id, email, full_name, is_admin,
       alvo_usuario, funcionario_alvo_codigo
  from public.profiles
 where email = 'ana.sanches@pfbrazil.com';

-- quantas linhas seriam afetadas (tem de ser exatamente 1)
select count(*) as linhas_que_seriam_afetadas
  from public.profiles
 where email = 'ana.sanches@pfbrazil.com';

rollback;
-- Esperado: ANTES com alvo_usuario null · DEPOIS com 'ANA.SANCHES' ·
--           linhas_que_seriam_afetadas = 1


-- =====================================================================
-- BLOCO 2 — APLICACAO REAL (rodar so depois de conferir o dry-run)
-- =====================================================================
update public.profiles
   set alvo_usuario = 'ANA.SANCHES'
 where email = 'ana.sanches@pfbrazil.com'
   and alvo_usuario is null;

notify pgrst, 'reload schema';


-- =====================================================================
-- BLOCO 3 — VERIFICACAO POR LEITURA (Regra 6)
-- =====================================================================

-- 3.1 A Ana ficou com o login
select email, full_name, alvo_usuario, funcionario_alvo_codigo
  from public.profiles
 where email = 'ana.sanches@pfbrazil.com';
-- Esperado: alvo_usuario = 'ANA.SANCHES'

-- 3.2 Panorama de quem opera projetos: quem pode e quem nao pode enviar ao ERP
select pf.email,
       pf.alvo_usuario,
       pf.funcionario_alvo_codigo,
       exists (select 1 from public.projetos p where p.responsavel_id = pf.user_id) as e_responsavel,
       case when pf.alvo_usuario is null
            then 'BLOQUEADO no envio (por desenho)'
            else 'pode enviar ao ERP' end as situacao_envio
  from public.profiles pf
 where exists (select 1 from public.projetos p
                where p.responsavel_id = pf.user_id or p.aprovador_id = pf.user_id)
 order by pf.email;
-- Esperado: ana.sanches -> pode enviar · nfe@ -> BLOQUEADO (D-17, correto) ·
--           fernando.oliveira (aprovador) -> BLOQUEADO, e nao precisa enviar


-- =====================================================================
-- ROLLBACK (se precisar desfazer):
--   update public.profiles set alvo_usuario = null
--    where email = 'ana.sanches@pfbrazil.com';
--   notify pgrst, 'reload schema';
-- =====================================================================
