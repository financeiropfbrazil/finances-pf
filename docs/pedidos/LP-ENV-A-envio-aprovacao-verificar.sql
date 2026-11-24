-- LP-ENV A — conferência (só leitura)

-- 1. Distribuição por origem (24/11/2026, após aplicar: desconhecido 1.364 · aproximado 914 · botao_hub 118 · sem data/não enviado 133)
select coalesce(enviado_aprovacao_origem, '(não enviado)') as origem, count(*),
       min(enviado_aprovacao_em) at time zone 'America/Sao_Paulo' as de, max(enviado_aprovacao_em) at time zone 'America/Sao_Paulo' as ate
from public.compras_pedidos group by 1 order by 2 desc;

-- 2. Coerência: envio nunca depois da aprovação final (esperado: 0)
select count(*) from public.compras_pedidos
where enviado_aprovacao_em is not null and data_aprovacao_alvo is not null and enviado_aprovacao_em > data_aprovacao_alvo;

-- 3. Pedido enviado sem origem (esperado: 0 — o gatilho carimba)
select numero, status_aprovacao, enviou_aprovacao, aprovado from public.compras_pedidos
where enviado_aprovacao_origem is null
  and (enviou_aprovacao = 'Sim' or coalesce(status_aprovacao, 'Nenhum') <> 'Nenhum' or aprovado in ('Total', 'Parcial'));

-- 4. Gatilho e permissão
select tgname, tgenabled from pg_trigger where tgrelid = 'public.compras_pedidos'::regclass and not tgisinternal;
select has_function_privilege('anon', 'public.compras_pedidos_carimbar_envio_aprovacao()', 'execute') as anon; -- false

-- 5. Envios carimbados nos últimos 7 dias, por origem (depois da LP-ENV B, esperado: quase tudo "leitura")
select enviado_aprovacao_origem, count(*) from public.compras_pedidos
where enviado_aprovacao_em > now() - interval '7 days' group by 1;
