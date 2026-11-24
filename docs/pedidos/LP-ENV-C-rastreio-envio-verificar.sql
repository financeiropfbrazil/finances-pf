-- Conferência da LP-ENV C (rastreio_compras_listar com o envio para aprovação).
-- Aplicada em 24/11/2026: md5 394f02f1cf48ecb0c0ca1efacee7bd84 → 8390bc194d84f37672632c23f0a5f556; ACL igual
-- ({postgres, authenticated, service_role}, sem anon); security definer mantido.
-- Teste antes de aplicar (transação desfeita, como admin): 3.512 linhas = 3.512, as 1.000 da página idênticas
-- fora os 2 campos novos, 768 com data de envio, 292 ms.

select position('pedido_envio_aprovacao' in pg_get_functiondef(
         'public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure)) > 0 as aplicada,
       md5(pg_get_functiondef('public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure)) as md5,
       (select proacl::text from pg_proc
         where oid = 'public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure) as acl;

-- Como usuário (a RPC exige auth): rodar num DO com
--   perform set_config('request.jwt.claims', '{"sub":"<user_id>","role":"authenticated"}', true);
-- e ler public.rastreio_compras_listar(null, null, 'pedido', null, null, 50, 0)->'linhas'
-- procurando pedido_envio_aprovacao / pedido_envio_origem.
