# AJUSTE 1.3 — Motivos estruturados de rejeição + limpeza de erro no roteamento
## Missão Aprovação de Requisições · pós-validação da Fase 5

> Guia v2, Ajuste 1.1, Ajuste 1.2, PROMPT-3-FASE3 e FASE6 permanecem INTACTOS.
> Este Ajuste manda dentro do seu escopo. Base: validação real de 10/08/2026 (Hugo Maffei).
> **Contexto:** o gate está no ar e funcionando. Ajustes de refinamento, não de correção estrutural.

---

## 1. Origem (o que a validação revelou)

1. **Motivo de rejeição é texto livre** → não agrega, não vira indicador. Pedido do Controller:
   catálogo estruturado para permitir estudo de "motivos de rejeição" ao longo do tempo.
2. **`erro_ultimo_envio` não é limpo ao rotear** → a requisição do Hugo apareceu simultaneamente
   como "Pendente aprovação" **e** "Erro no último envio" (erro herdado da tentativa que falhou
   no CHECK constraint, antes da correção). Estado visualmente contraditório.
3. **Constraint de status** já corrigida em produção (9 valores). Registrado aqui como lição:
   `status text` **com CHECK** se comporta como enum na hora de gravar — o Discovery mediu o tipo,
   não a constraint. **Toda missão futura que introduza valor novo em coluna de status deve
   perguntar: "existe CHECK nessa coluna?"**

---

## 2. Decisões (Pedro, 10/08/2026)

| # | Tema | Decisão |
|---|---|---|
| G1 | Quantidade de motivos | **Um só** por rejeição. Nuances vão na observação |
| G2 | Observação | **Obrigatória apenas em "Outros"** (mín. 5 caracteres). Opcional nos demais |
| G3 | Catálogo | 10 motivos (§3.1), gerenciável em tabela — não hard-coded no frontend |
| G4 | Retrocompatibilidade | Rejeições anteriores (texto livre) permanecem válidas, sem motivo estruturado |

---

## 3. Modelo de dados

### 3.1 Catálogo de motivos

```sql
create table if not exists public.compras_motivos_rejeicao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  rotulo text not null,
  exige_observacao boolean not null default false,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.compras_motivos_rejeicao enable row level security;

create policy motivos_rejeicao_select on public.compras_motivos_rejeicao
  for select to authenticated using (true);
-- Sem policies de escrita: gestão via SQL Editor (admin).
```

Seed (ordem = sequência no dropdown):

```sql
insert into public.compras_motivos_rejeicao (codigo, rotulo, exige_observacao, ordem) values
  ('gestao_custos',        'Gestão de custos',                        false, 10),
  ('sem_verba',            'Sem verba no período',                    false, 20),
  ('duplicidade',          'Duplicidade (já requisitado)',            false, 30),
  ('ja_em_estoque',        'Já disponível em estoque',                false, 40),
  ('cc_incorreto',         'Centro de custo incorreto',               false, 50),
  ('classe_incorreta',     'Classificação contábil incorreta',        false, 60),
  ('item_incorreto',       'Item/especificação incorreta',            false, 70),
  ('sem_necessidade',      'Sem necessidade da compra',               false, 80),
  ('reprogramar',          'Fora do momento (reprogramar)',           false, 90),
  ('outros',               'Outros',                                  true, 100)
on conflict (codigo) do nothing;
```

### 3.2 Coluna na requisição

```sql
alter table public.compras_requisicoes
  add column if not exists motivo_rejeicao_codigo text;
```

`motivo_rejeicao` (texto) **permanece** e passa a guardar a observação. Rejeições antigas ficam com
`motivo_rejeicao_codigo` nulo — é o comportamento esperado (G4).

```sql
notify pgrst, 'reload schema';
```

### 3.3 Trigger de proteção

⚠️ `fn_req_protege_aprovacao` **precisa passar a proteger `motivo_rejeicao_codigo`** junto com as
demais colunas de decisão — senão a coluna nova fica gravável por API direta. Recriar a função
(tag nomeada `$trg$`, **nunca `$$` puro**) acrescentando a comparação da coluna nova no ramo UPDATE
e a checagem `is not null` no ramo INSERT.

---

## 4. RPCs

### 4.1 `rejeitar_requisicao` — nova assinatura

```
rejeitar_requisicao(p_req_id uuid, p_motivo_codigo text, p_observacao text) returns text
```

Regras:
1. **Dropar a assinatura antiga** `(uuid, text)` — não deixar as duas vivas (caminho velho pularia
   o catálogo).
2. Validar `p_motivo_codigo` contra `compras_motivos_rejeicao` (existente e `ativo`) →
   senão `MOTIVO_INVALIDO`.
3. Se o motivo tiver `exige_observacao=true` e a observação for nula ou `< 5` caracteres →
   `OBSERVACAO_OBRIGATORIA`.
4. Demais gates permanecem **idênticos** (permissão `compras.requisicoes.aprovar`, escopo por CC,
   `is_admin`, `auth.uid() is null`, status `pendente_aprovacao`, `FOR UPDATE`).
5. Grava `motivo_rejeicao_codigo` e `motivo_rejeicao` (observação, `trim`, pode ser nulo).
6. Evento de auditoria `rejeitada_lider` passa a levar `motivo_codigo` **e** `observacao` no payload.
7. **Recriar com tag nomeada `$r3$`.** `SECURITY DEFINER` + `set search_path = public` redeclarados.
   `grant execute … to authenticated` na assinatura nova.

### 4.2 `submeter_requisicao` — limpar erro ao rotear

Nos três desfechos de sucesso (`SEM_GATE`, `AUTO_APROVADA`, `PENDENTE`), o UPDATE passa a incluir
`erro_ultimo_envio = null`. Elimina o estado contraditório "Pendente aprovação + Erro no último
envio". **Recriar com tag `$r1$`**, mantendo todo o resto idêntico.

> ⚠️ `CREATE OR REPLACE` não preserva `SECURITY DEFINER` nem `search_path` — redeclarar sempre.

---

## 5. Frontend

1. **Modal de rejeição:** dropdown de motivos (lido de `compras_motivos_rejeicao`, ordenado por
   `ordem`, só `ativo`), com observação em textarea. A observação vira **obrigatória** (mín. 5,
   contador visível) quando o motivo selecionado tiver `exige_observacao=true`; caso contrário,
   opcional. Botão Rejeitar desabilitado enquanto a seleção for inválida.
2. **Chamada:** `rpc('rejeitar_requisicao', { p_req_id, p_motivo_codigo, p_observacao })`.
   Tratar `MOTIVO_INVALIDO` e `OBSERVACAO_OBRIGATORIA` com mensagem visível, além dos retornos já
   tratados.
3. **Exibição no detalhe:** card de rejeição mostra **rótulo do motivo** em destaque + observação
   (quando houver) + quem + quando. Rejeições antigas (sem código) continuam mostrando só o texto.
4. **Card de erro no detalhe:** só exibir "Erro no último envio" quando fizer sentido para o status
   atual — não exibir em `pendente_aprovacao` (o erro é histórico; a limpeza do §4.2 resolve os
   casos novos, mas a UI não deve depender só disso).

---

## 6. Fora de escopo

Tela de administração do catálogo de motivos (gestão por SQL Editor por enquanto) · relatório/
dashboard de motivos de rejeição (o dado passa a existir; a análise é missão futura) · múltiplos
motivos por rejeição (G1) · notificações · **DÍVIDA-RLS-COMPRAS-REQ**.

---

## 7. Gate de saída

1. `bun run build` limpo · `tsc --noEmit` sem erros novos.
2. Assinatura antiga de `rejeitar_requisicao(uuid, text)` **não existe mais** em
   `information_schema.routines`; a nova existe e está com `grant` para `authenticated`.
3. Trigger recriado protege `motivo_rejeicao_codigo` (conferir `pg_get_functiondef`).
4. Nenhum caminho novo ao ERP — mapa de rotas do Ajuste 1.2 §6 segue válido.
5. Commit com staging explícito, **sem push** até revisão.

---

## 8. Validação (após execução do SQL pelo Pedro)

1. Rejeitar com motivo do catálogo, sem observação → sucesso; detalhe mostra o rótulo.
2. Rejeitar com "Outros" sem observação → bloqueado na UI **e** `OBSERVACAO_OBRIGATORIA` na RPC.
3. Rejeitar com "Outros" com observação → sucesso; detalhe mostra rótulo + texto.
4. A rejeição antiga do Hugo (texto livre) continua legível, sem quebrar a tela.
5. Nova requisição submetida → detalhe **não** mostra "Erro no último envio" residual.
6. Agregação funciona:
   `select motivo_rejeicao_codigo, count(*) from compras_requisicoes where status='rejeitada' group by 1;`

---

## 9. PROMPT — colar na sessão do Claude Code

```
PROMPT 1.3 — Motivos estruturados de rejeição + limpeza de erro no roteamento

Leia, nesta ordem: CLAUDE.md (protocolo de início) → ESTADO-APROVACAO-REQ.md
→ CLAUDE_APROVACAO_REQ.md (guia v2) → AJUSTE-1.1 → AJUSTE-1.2 → PROMPT-3-FASE3
→ AJUSTE-1.3-MOTIVOS-REJEICAO.md (este manda; é o escopo desta sessão).

Estado: gate no ar e validado em produção com o Hugo (10/08). CHECK constraint de status já
corrigida por mim no SQL Editor (9 valores). Fase 3 publicada.

Escopo: §3, §4 e §5 do Ajuste 1.3, nada além. §6 lista o que NÃO fazer.

Entregue nesta ordem:
1. Um arquivo SQL-AJUSTE13.md na raiz com TODOS os blocos SQL (§3 e §4) prontos para eu colar,
   um statement por bloco, na ordem de execução, com o resultado esperado de cada um e as
   conferências do §7 itens 2 e 3 ao final. ⚠️ TAGS NOMEADAS OBRIGATÓRIAS em todo CREATE FUNCTION
   ($r1$, $r3$, $trg$) — o SQL Editor do Supabase corrompe corpos $$ em silêncio (armadilha
   registrada no ESTADO §…). NÃO execute nada: MCP é read-only e a execução é minha.
2. O frontend do §5 (modal com dropdown, chamada com a nova assinatura, exibição no detalhe,
   card de erro condicionado ao status).

Antes de codar, verifique e relate (read-only):
- a definição atual de fn_req_protege_aprovacao (pg_get_functiondef) — você vai recriá-la
  acrescentando motivo_rejeicao_codigo, preservando todo o resto;
- a definição atual de submeter_requisicao e rejeitar_requisicao, para recriar sem perder nada;
- se algum outro ponto do código chama rejeitar_requisicao com a assinatura antiga.

NÃO TOCAR: banco (escrita), crons/Edge Functions, types.ts, fila do líder além do modal,
arquivos de outras missões no working tree.

Gate de saída: §7. Git: staging explícito, commit
"feat(suprimentos): motivos estruturados de rejeicao (AJUSTE 1.3)". SEM push.
Atualize o ESTADO-APROVACAO-REQ.md (incluindo a lição da CHECK constraint, §1 item 3 do Ajuste).
Termine com: arquivos alterados, o que mudou nas 3 funções, e o que contradisse a espec.
```

---

*Fim do Ajuste 1.3. Depois: eu executo o SQL, revisão, push, Publicar, validação §8.*
