-- =====================================================================
-- NFE-18 — Operador de Compras: consulta e operação nas notas, sem vincular pedido — 12/11/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (12/11): "operador de compras pode ver as NFe, NFS … Inclua a consulta
-- completa dessas seções naturalmente ao Operador de Compras. Tambem o rastreio de Compras (suprimentos/rastreio), mas
-- teremos que revisá-lo" → correção: "ele poderá anexar (tanto NF quanto boleto), subir XML, comentar. A única coisa
-- que ele não faz é vincular."
--
-- O que faz:
--   1. Permissão nova compras.nfe.vincular ("Vincular pedido à NF-e") → admin e Analista Fiscal.
--   2. Função nfe_pode_vincular() (admin ou compras.nfe.vincular).
--   3. compras_nfe_vincular_pedidos e compras_nfe_desvincular passam de nfe_pode_gravar() (compras.nfe.create) para
--      nfe_pode_vincular(). Subir XML e anexar continuam em compras.nfe.create.
--   4. Operador de Compras (analista_compras) ganha compras.nfe.access, compras.nfe.create e compras.rastreio.access.
--      (NFS-e: o Operador já tinha compras.nfse.access, que cobre ver, anexar e comentar — a NFS-e não tem vincular.)
--   5. Descrição de compras.nfe.create passa a dizer o que ela libera.
-- Rollback: NFE-18-operador-compras-rollback.sql.
-- =====================================================================

do $$
declare
  v_vinc text := pg_get_functiondef('public.compras_nfe_vincular_pedidos(uuid,jsonb)'::regprocedure);
  v_desv text := pg_get_functiondef('public.compras_nfe_desvincular(uuid)'::regprocedure);
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if md5(v_vinc) <> '8add1957bed20c0692361db4ec0489fa' or md5(v_desv) <> '5a6f25c1a4049a649ac4ac2596c29073' then
    raise exception 'As funções de vínculo mudaram desde a leitura — revisar antes de aplicar';
  end if;
  if exists (select 1 from public.hub_permissions where codigo = 'compras.nfe.vincular') then
    raise exception 'compras.nfe.vincular já existe — NFE-18 já aplicada?';
  end if;
end $$;

-- 1. Permissão nova
insert into public.hub_permissions (codigo, nome, descricao, modulo)
values ('compras.nfe.vincular', 'Vincular pedido à NF-e',
        'Vincular e desvincular pedido de compra à NF-e (botão "Vincular" da tela de Notas Fiscais)', 'compras');

update public.hub_permissions
   set descricao = 'Subir XML de NF-e e anexar/remover o PDF da nota (DANFE) e do boleto'
 where codigo = 'compras.nfe.create';

-- 2. Papéis
insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id
from public.hub_roles r
join public.hub_permissions p on (r.codigo, p.codigo) in (
  ('admin', 'compras.nfe.vincular'),
  ('analista_fiscal', 'compras.nfe.vincular'),
  ('analista_compras', 'compras.nfe.access'),
  ('analista_compras', 'compras.nfe.create'),
  ('analista_compras', 'compras.rastreio.access'))
on conflict (role_id, permission_id) do nothing;

-- 3. Gate do vincular
create function public.nfe_pode_vincular()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
  select public._is_admin() or coalesce(public.user_has_permission(auth.uid(), 'compras.nfe.vincular'), false);
$fn$;
comment on function public.nfe_pode_vincular() is 'NFE-18: vincular/desvincular pedido à NF-e (admin ou compras.nfe.vincular).';
revoke execute on function public.nfe_pode_vincular() from public, anon;

do $$
declare
  f   text;
  def text;
  novo text;
begin
  foreach f in array array['public.compras_nfe_vincular_pedidos(uuid,jsonb)', 'public.compras_nfe_desvincular(uuid)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if (length(def) - length(replace(def, 'public.nfe_pode_gravar()', ''))) / length('public.nfe_pode_gravar()') <> 1 then
      raise exception '% não tem exatamente uma chamada a nfe_pode_gravar()', f;
    end if;
    novo := replace(def, 'public.nfe_pode_gravar()', 'public.nfe_pode_vincular()');
    execute novo;   -- CREATE OR REPLACE: mantém dono e permissões
    if md5(pg_get_functiondef(f::regprocedure)) <> md5(novo) then
      raise exception 'Troca do gate não conferiu em %', f;
    end if;
  end loop;
end $$;
