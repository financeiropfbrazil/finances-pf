# AJUSTE 1.1 — Missão Aprovação de Requisições
## SQL definitivo da Fase 1 + correções de espec das Fases 2–3 (pós-Discovery)

> **Convenção:** o `CLAUDE_APROVACAO_REQ.md` (v2) permanece INTACTO. Este Ajuste **substitui o §5** (Fase 1)
> e **corrige pontos dos §6–§7** (Fases 2–3) do guia, com base no `DISCOVERY-APROVACAO-REQ.md` (PROMPT 0)
> e nas decisões do Pedro de 06/08. Em conflito entre o guia e este Ajuste, **vale o Ajuste**.
> Referências: guia v2 · discovery (D1–D13, §15 contradições, §16 perguntas) · `Permissoes_e_Roles_v2.md`.

---

## 1. Decisões que este Ajuste incorpora (fechadas em 06/08)

| # | Tema | Decisão |
|---|---|---|
| A1 | CC do piloto | **Somente `00010.00002.00003` (FINANCEIRO)**. O homônimo `00001.00001.00004` fica fora |
| A2 | Erro de envio | **Reusar `erro_ultimo_envio` (text)** — é o que a tela lê. NÃO criar `erro_envio jsonb` |
| A3 | Auditoria | **Eventos na `compras_requisicoes_auditoria` existente** (719 linhas, viva) + colunas de estado na req. A decisão 12 do guia (só colunas) foi tomada sem saber da tabela — superada |
| A4 | Pendentes na listagem | **Mostrar com badge** (não esconder — mexer nas queries de listagem é a zona own/all). Motivo da rejeição visível no detalhe para todos; destaque para o criador |
| A5 | RLS `ALL using true` | **Dívida formal** (§6 deste Ajuste) + **trigger de integridade** protegendo estados/colunas de decisão contra escrita direta via API |
| A6 | Rascunho | Confirmado inexistente (wizard one-shot) → **Fase 2 cria**: split `criarRequisicao()` + `enviarRequisicaoAlvo(id)`. RPC de submissão **mantém** exigência `status='rascunho'` |
| A7 | §5.5 do guia (policies de leitura do líder) | **CANCELADO** — inócuo: a RLS atual já é `ALL using true`; o líder lê tudo hoje. As policies voltam ao escopo quando a dívida A5 for paga |

---

## 2. FASE 1 — SQL definitivo (Claude Code ajusta pelo D14; Pedro executa no SQL Editor)

**Pré-voo obrigatório (D14, read-only, via MCP na sessão do PROMPT 1):**

```sql
-- D14. Schema real da tabela de auditoria (as RPCs inserem nela — colunas têm que bater)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='compras_requisicoes_auditoria'
order by ordinal_position;

-- D14b. Vocabulário de eventos já usado (para manter o padrão de nomenclatura)
select evento, count(*) from compras_requisicoes_auditoria group by 1 order by 2 desc;
-- (se a coluna não se chamar 'evento', ajustar pela D14)

-- Pré-voo de lock (ritual): nenhuma transação velha aberta
select pid, usename, state, xact_start, left(query,80) q
from pg_stat_activity
where state <> 'idle' and xact_start < now() - interval '2 minutes';
```

> ⚠️ O helper §2.3 abaixo está escrito contra o shape PRESUMIDO `(requisicao_id, evento, detalhe, user_id)`.
> O PROMPT 1 **ajusta o helper às colunas reais do D14** antes de entregar o SQL ao Pedro. Se a tabela tiver
> colunas NOT NULL extras, preenchê-las; se o nome do campo de evento/payload for outro, renomear no helper.
> **Só o helper muda** — as RPCs chamam o helper, então ficam estáveis.

Statements **atômicos e separados** (SQL Editor abandona BEGIN/COMMIT em silêncio). `NOTIFY pgrst` ao final de cada bloco de DDL.

### 2.1 RBAC — permissão + papel (inalterado do guia §5.1, confirmado pelo D7)

```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.requisicoes.aprovar', 'Aprovar Requisições',
       'Aprovar/rejeitar requisições pendentes dos centros de custo sob sua liderança', 'compras'
where not exists (select 1 from hub_permissions where codigo='compras.requisicoes.aprovar');

insert into hub_roles (codigo, nome, descricao, modulo, is_system)
select 'lider_departamento', 'Líder de Departamento',
       'Aprova requisições de compra dos centros de custo que lidera', 'compras', false
where not exists (select 1 from hub_roles where codigo='lider_departamento');

insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='lider_departamento'
  and p.codigo in ('compras.requisicoes.access','compras.requisicoes.aprovar')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

-- Lição §9.1 (13 órfãs): permissão nova TAMBÉM no papel admin
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='admin' and p.codigo='compras.requisicoes.aprovar'
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```

### 2.2 Mapeamento líder↔CC + colunas de decisão (A2: SEM erro_envio jsonb)

```sql
create table if not exists public.compras_lideres_cc (
  id uuid primary key default gen_random_uuid(),
  lider_user_id uuid not null,            -- = profiles.user_id = auth.uid()
  codigo_centro_ctrl text not null,       -- formato confirmado no D3, ex. '00010.00002.00003'
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lider_user_id, codigo_centro_ctrl)
);

alter table public.compras_lideres_cc enable row level security;

create policy lideres_cc_select on public.compras_lideres_cc
  for select to authenticated using (true);
-- Sem policies de escrita: gestão só via SQL Editor (admin).
```

```sql
alter table public.compras_requisicoes
  add column if not exists aprovada_por_user_id uuid,
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovacao_automatica boolean not null default false,
  add column if not exists rejeitada_por_user_id uuid,
  add column if not exists rejeitada_em timestamptz,
  add column if not exists motivo_rejeicao text;
```

```sql
notify pgrst, 'reload schema';
```

### 2.3 Helper de auditoria (⚠️ AJUSTAR PELO D14 antes de rodar)

```sql
drop function if exists public._req_evento(uuid, text, jsonb);
create function public._req_evento(p_req_id uuid, p_evento text, p_detalhe jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SHAPE PRESUMIDO — o PROMPT 1 confere no D14 e ajusta colunas/nomes:
  insert into compras_requisicoes_auditoria (requisicao_id, evento, detalhe, user_id)
  values (p_req_id, p_evento, p_detalhe, auth.uid());
exception when others then
  -- auditoria nunca derruba a operação principal, mas GRITA no log (regra 9 do guia)
  raise warning '_req_evento falhou para % (%): %', p_req_id, p_evento, sqlerrm;
end;
$$;
```

### 2.4 RPCs (SECURITY DEFINER, POST; com eventos de auditoria — A3)

```sql
-- R1. Submissão com roteamento (chamada pelo wizard APÓS criarRequisicao() persistir o rascunho — A6)
drop function if exists public.submeter_requisicao(uuid);
create function public.submeter_requisicao(p_req_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_is_lider boolean;
  v_tem_lider boolean;
begin
  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'rascunho' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  if v_req.requisitante_user_id is distinct from auth.uid()
     and not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then
    return 'NAO_AUTORIZADO';
  end if;
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.create') then
    return 'SEM_PERMISSAO';
  end if;
  if v_req.codigo_centro_ctrl is null then return 'SEM_CENTRO_CUSTO'; end if;

  select exists (select 1 from compras_lideres_cc
                  where codigo_centro_ctrl = v_req.codigo_centro_ctrl and ativo)
    into v_tem_lider;
  if not v_tem_lider then
    perform public._req_evento(p_req_id, 'submetida_sem_gate',
             jsonb_build_object('cc', v_req.codigo_centro_ctrl));
    return 'SEM_GATE';   -- CC fora do rollout → frontend segue o envio legado
  end if;

  select exists (select 1 from compras_lideres_cc
                  where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                    and lider_user_id = auth.uid() and ativo)
    into v_is_lider;
  if v_is_lider then
    update compras_requisicoes
       set status='aprovada', aprovada_por_user_id=auth.uid(), aprovada_em=now(),
           aprovacao_automatica=true, updated_at=now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'aprovada_lider',
             jsonb_build_object('automatica', true, 'cc', v_req.codigo_centro_ctrl));
    return 'AUTO_APROVADA';
  end if;

  update compras_requisicoes
     set status='pendente_aprovacao', updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'enviada_aprovacao',
           jsonb_build_object('cc', v_req.codigo_centro_ctrl));
  return 'PENDENTE';
end;
$$;

-- R2. Líder aprova
drop function if exists public.aprovar_requisicao(uuid);
create function public.aprovar_requisicao(p_req_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_admin boolean;
begin
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  select coalesce(is_admin,false) into v_admin from profiles where user_id = auth.uid();
  if not v_admin and not exists (
      select 1 from compras_lideres_cc
       where codigo_centro_ctrl = v_req.codigo_centro_ctrl
         and lider_user_id = auth.uid() and ativo) then
    return 'FORA_DO_SEU_CC';
  end if;

  update compras_requisicoes
     set status='aprovada', aprovada_por_user_id=auth.uid(), aprovada_em=now(),
         aprovacao_automatica=false, updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'aprovada_lider',
           jsonb_build_object('automatica', false, 'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$$;

-- R3. Líder rejeita (motivo obrigatório; terminal)
drop function if exists public.rejeitar_requisicao(uuid, text);
create function public.rejeitar_requisicao(p_req_id uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_admin boolean;
begin
  if p_motivo is null or length(trim(p_motivo)) < 5 then return 'MOTIVO_OBRIGATORIO'; end if;
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  select coalesce(is_admin,false) into v_admin from profiles where user_id = auth.uid();
  if not v_admin and not exists (
      select 1 from compras_lideres_cc
       where codigo_centro_ctrl = v_req.codigo_centro_ctrl
         and lider_user_id = auth.uid() and ativo) then
    return 'FORA_DO_SEU_CC';
  end if;

  update compras_requisicoes
     set status='rejeitada', rejeitada_por_user_id=auth.uid(), rejeitada_em=now(),
         motivo_rejeicao=trim(p_motivo), updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'rejeitada_lider',
           jsonb_build_object('motivo', trim(p_motivo), 'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$$;

-- R4. Desfecho do envio pós-aprovação (A2: erro em erro_ultimo_envio TEXT)
--     ⚠️ ÚNICO caminho de persistência quando a req está 'aprovada' — o trigger §2.5 bloqueia o resto.
drop function if exists public.registrar_envio_requisicao(uuid, text, jsonb);
drop function if exists public.registrar_envio_requisicao(uuid, text, text);
create function public.registrar_envio_requisicao(p_req_id uuid, p_numero_alvo text, p_erro text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_admin boolean;
  v_autorizado boolean;
begin
  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'aprovada' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  select coalesce(is_admin,false) into v_admin from profiles where user_id = auth.uid();
  v_autorizado := v_admin
    or v_req.requisitante_user_id = auth.uid()
    or exists (select 1 from compras_lideres_cc
                where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                  and lider_user_id = auth.uid() and ativo);
  if not v_autorizado then return 'NAO_AUTORIZADO'; end if;

  if p_numero_alvo is not null then
    update compras_requisicoes
       set numero_alvo = p_numero_alvo, status = 'sincronizada',
           erro_ultimo_envio = null, updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'envio_pos_aprovacao_ok',
             jsonb_build_object('numero_alvo', p_numero_alvo));
    return 'SINCRONIZADA';
    -- ⚠️ PROMPT 1: se o D8 mostrou que o envio legado grava MAIS campos no sucesso
    -- (datas, flags), espelhar aqui — a RPC não pode gravar menos que o legado.
  else
    update compras_requisicoes
       set erro_ultimo_envio = coalesce(p_erro, 'erro desconhecido'), updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'envio_pos_aprovacao_erro',
             jsonb_build_object('erro', left(coalesce(p_erro,'?'), 500)));
    return 'ERRO_REGISTRADO';
  end if;
end;
$$;

grant execute on function public.submeter_requisicao(uuid) to authenticated;
grant execute on function public.aprovar_requisicao(uuid) to authenticated;
grant execute on function public.rejeitar_requisicao(uuid, text) to authenticated;
grant execute on function public.registrar_envio_requisicao(uuid, text, text) to authenticated;
```

```sql
notify pgrst, 'reload schema';
```

### 2.5 Trigger de integridade (A5 — o gate deixa de ser só de UI)

A RLS atual (`ALL using true`) permite a qualquer authenticated escrever em qualquer req via API.
Este trigger fecha **só** a superfície da aprovação: estados novos e colunas de decisão ficam
intocáveis por escrita direta. RPCs (SECURITY DEFINER → `current_user='postgres'`) e
crons/Edge (`service_role`) passam; fluxos legados nunca tocam esses estados → passam intactos.

```sql
create or replace function public.fn_req_protege_aprovacao()
returns trigger
language plpgsql
-- SECURITY INVOKER (default) DE PROPÓSITO: current_user precisa refletir quem chama
as $$
declare
  protegidos constant text[] := array['pendente_aprovacao','aprovada','rejeitada'];
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status = any(protegidos)
         or new.aprovada_por_user_id is not null or new.aprovada_em is not null
         or new.rejeitada_por_user_id is not null or new.rejeitada_em is not null
         or new.motivo_rejeicao is not null
         or coalesce(new.aprovacao_automatica,false) then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovação (insert)';
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      if old.status = any(protegidos)            -- linha em estado protegido: intocável por API direta
         or new.status = any(protegidos)         -- entrar em estado protegido por fora
         or new.aprovada_por_user_id  is distinct from old.aprovada_por_user_id
         or new.aprovada_em           is distinct from old.aprovada_em
         or new.aprovacao_automatica  is distinct from old.aprovacao_automatica
         or new.rejeitada_por_user_id is distinct from old.rejeitada_por_user_id
         or new.rejeitada_em          is distinct from old.rejeitada_em
         or new.motivo_rejeicao       is distinct from old.motivo_rejeicao then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovação (update)';
      end if;
      return new;
    else  -- DELETE: rejeitada é registro de auditoria; pendente não se apaga por fora
      if old.status = any(protegidos) then
        raise exception 'PROTEGIDO_APROVACAO: registro do fluxo de aprovação não pode ser excluído via API';
      end if;
      return old;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_req_protege_aprovacao on public.compras_requisicoes;
create trigger trg_req_protege_aprovacao
  before insert or update or delete on public.compras_requisicoes
  for each row execute function public.fn_req_protege_aprovacao();
```

**Efeito colateral desejado:** o `reenviarRequisicao` legado (que rebaixa `aprovada`→`rascunho`, achado
do discovery) agora é **bloqueado no banco** se algum caminho de código escapar da correção da Fase 2 —
defesa em profundidade.

### 2.6 Seed do piloto (A1 — só o CC FINANCEIRO)

```sql
insert into hub_user_roles (user_id, role_id, atribuido_por, atribuido_em, motivo)
select p.user_id, r.id, p.user_id, now(), 'Seed piloto — líder do Financeiro'
from profiles p, hub_roles r
where p.email='pedro.scrignoli@pfbrazil.com' and r.codigo='lider_departamento'
  and not exists (select 1 from hub_user_roles ur
                   where ur.user_id=p.user_id and ur.role_id=r.id and ur.revogado_em is null);

insert into compras_lideres_cc (lider_user_id, codigo_centro_ctrl)
select p.user_id, '00010.00002.00003'
from profiles p
where p.email='pedro.scrignoli@pfbrazil.com'
on conflict (lider_user_id, codigo_centro_ctrl) do nothing;
```

### 2.7 Gate de saída da Fase 1 (conferências no SQL Editor — read-only MCP não roda FOR UPDATE)

1. Colunas novas em `compras_requisicoes` (re-rodar D1) e tabela `compras_lideres_cc` presente.
2. Permissão + papel existem; papel `admin` tem `compras.requisicoes.aprovar` (query das órfãs do §9.1 devolve zero para ela).
3. As 4 RPCs + helper em `information_schema.routines`.
4. `select public.aprovar_requisicao(gen_random_uuid());` → `SEM_PERMISSAO` (SQL Editor não tem auth.uid) — prova a função viva.
5. Trigger: `update compras_requisicoes set motivo_rejeicao='x' where false;` roda OK no SQL Editor (postgres passa);
   a prova real do bloqueio é a Fase 5 item 9 (cobaia via API recebe `PROTEGIDO_APROVACAO`).
6. Seed presente: `select * from compras_lideres_cc;` → 1 linha (Pedro × 00010.00002.00003).
7. `notify pgrst, 'reload schema';` rodado por último.

---

## 3. FASE 2 — espec corrigida (substitui §6.1–6.2 do guia nestes pontos)

1. **Split do wizard (A6):** `enviarRequisicao` (one-shot) vira `criarRequisicao()` — persiste
   cabeçalho+itens+classes como `status='rascunho'` e devolve o `id` — e `enviarRequisicaoAlvo(id)`
   (o caminho Alvo de hoje, intacto). A submissão passa a ser: criar → `rpc('submeter_requisicao')` → rotear.
2. **Roteamento:** `SEM_GATE` → `enviarRequisicaoAlvo(id)` com a **persistência legada intacta**
   (rascunho→sincronizada não é tocado pelo trigger). `AUTO_APROVADA` e pós-APROVAR → `enviarRequisicaoAlvo(id)`
   com desfecho **exclusivamente** via `rpc('registrar_envio_requisicao')` — a persistência legada NÃO pode
   rodar nesses caminhos (o trigger bloquearia a escrita direta em req `aprovada`, e é por design).
3. **Reenviar pós-aprovação:** caminho novo. **NÃO usar** o `reenviarRequisicao` legado (rebaixa
   `aprovada`→`rascunho` e apagaria a decisão). O novo: req `aprovada` com `erro_ultimo_envio` →
   botão Reenviar → `enviarRequisicaoAlvo(id)` → desfecho via R4. Sem nova aprovação.
4. **Erro:** ler/escrever `erro_ultimo_envio` (text) — nada de campo novo (A2).
5. **Guardas de sync:** D5/D10 do discovery provaram os jobs seguros (filtros positivos + chave
   `numero_alvo`) → **nenhuma mudança em cron**. Só conferir no diff final que nada disso foi tocado.

## 4. FASE 3 — deltas (complementa §7 do guia)

1. **Badge, não esconder (A4):** `Pendente aprovação` (âmbar) e `Rejeitada` aparecem na listagem
   para quem tem `view_all`. Conversão em pedido segue travada por `status='sincronizada'` (D13).
2. **Motivo da rejeição:** visível no detalhe para todos; card em destaque para o criador.
3. **Rascunho agora existe de verdade** (nasce do split): "Salvar rascunho" no wizard = chamar
   `criarRequisicao()` sem submeter; lista mostra os rascunhos do usuário (`view_own`).
4. Fila do líder, clonar, filtros: como no guia §7 (sem mudanças).

## 5. Interação com o achado lateral do Alvo

O cabeçalho `ReqComp` traz `Aprovada/Reprovada` nativos que o Hub nunca leu. **Fora desta missão**
(o gate aprova ANTES de a req existir no Alvo). Registrado como candidato futuro: espelhar o campo
para reqs nativas descobertas pelo Job 4.

## 6. Dívida formal registrada — RLS da família de requisições

> **DÍVIDA-RLS-COMPRAS-REQ (aberta em 06/08/2026, origem: Discovery D4 desta missão).**
> `compras_requisicoes` e filhas (`_itens`, `_itens_classe_rec_desp`, `_arquivos`) têm policy
> `ALL using(true)` para authenticated: qualquer usuário logado lê E ESCREVE qualquer requisição
> via API direta (curl + JWT próprio). O trigger §2.5 protege apenas a superfície da aprovação.
> Pagamento da dívida (missão própria): SELECT own/all conforme permissões RBAC + leitura do líder
> por mapeamento; INSERT/UPDATE restritos ao dono/serviço; filhas idem; auditoria de todos os
> pontos de escrita legados antes de fechar. Risco enquanto aberta: contorno de RLS em dados de
> compras por qualquer authenticated. Prioridade sugerida: alta (pós-piloto).

## 7. PROMPT 1 — texto pronto para colar no Claude Code

```
PROMPT 1 — Fase 1 (SQL definitivo) da missão Aprovação de Requisições

Leia CLAUDE_APROVACAO_REQ.md (guia v2) e AJUSTE-1.1-APROVACAO-REQ.md (este manda em caso de conflito).
Leia também DISCOVERY-APROVACAO-REQ.md (seus próprios achados do PROMPT 0).

Tarefa desta sessão (ainda SEM tocar código do frontend):
1. Rode o pré-voo D14/D14b do Ajuste §2 via MCP (read-only) e o check de transação velha.
2. Ajuste o helper _req_evento (§2.3) às colunas REAIS da compras_requisicoes_auditoria e ao
   vocabulário de eventos existente (D14b). Se o D8 do discovery mostrou que o envio legado grava
   campos além de numero_alvo/status no sucesso, espelhe-os na R4 (marcador dentro dela).
3. Gere na raiz o arquivo SQL-FASE1-APROVACAO.md com TODOS os blocos do Ajuste §2 já ajustados,
   na ordem de execução, um bloco por statement, com o gate de saída §2.7 ao final.
4. NÃO execute nada de escrita — o MCP é read-only e a execução é minha, no SQL Editor.
5. Git: add APENAS do SQL-FASE1-APROVACAO.md (staging explícito), commit
   "feat(suprimentos): sql fase 1 aprovacao de requisicoes (PROMPT 1)". SEM push — eu reviso.
6. Termine com: o que mudou em relação ao Ajuste (helper/R4), e qualquer surpresa do D14.
```

## 8. Pendências (não bloqueiam PROMPT 1 nem a execução da Fase 1)

1. **Cobaia da Fase 5:** um usuário `requisitante`, sem `is_admin` e sem papel de líder (Pedro indica).
2. Ordem de execução após o PROMPT 1: Pedro roda o SQL-FASE1 no SQL Editor (com o ritual de lock antes),
   confere o gate §2.7, e só então dispara o PROMPT 2 (Fase 2 — código).

---

*Fim do Ajuste 1.1. Guia v2 intacto; este arquivo substitui o §5 e corrige §6–§7. Próximo: PROMPT 1.*
