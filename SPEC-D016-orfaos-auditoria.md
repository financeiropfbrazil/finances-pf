# SPEC-D016 — Auditoria e quarentena de órfãos: tornar a deleção reversível por construção

> **Repo alvo:** `erp-proxy` (rota `docfin-despesas`) + DDL no Supabase.
> **Autor:** agente (especificação funcional) · **Implementação e deploy:** Pedro (regra 11 — o agente não toca o erp-proxy).
> **Origem:** achado de 20/07/2026 durante o backfill do D-001. Card **D-016** no `PLANO-DESPESAS.md`.

---

## 0. Resumo executivo

A limpeza de órfãos **apaga documentos e rateios de forma irreversível, sem registrar o que apagou**. Isso roda **em toda rodada do cron — 3× ao dia, sobre as 3 competências da janela rolante** — sem ninguém olhando. A trava de teto (`max(25; 30% dos docs)`) impede deleção **em massa**, mas **deleção pequena passa silenciosa**: uma listagem parcial do Alvo num dia ruim remove documentos e não fica rastro.

O dump manual que passamos a exigir (armadilha 28) protege **só o backfill**. `mai/jun/jul` — as competências da janela rolante — estão **permanentemente desprotegidas**.

Esta spec transforma proteção-por-procedimento em **proteção estrutural**, no mesmo espírito do `uq_desp_docfin_rateio_grao` do D-006: **o motor grava o que vai apagar, na mesma transação, antes de apagar.** E muda o default para **não apagar**.

**Precedente concreto:** na rodada do cron das 15:11 de 20/07, junho teve **31 órfãos / R$ 109.889,94** removidos automaticamente, sem dump. Não há como saber hoje quanto era duplicata legítima (D-013) e quanto era despesa real perdida.

---

## 1. Recomendação de política (a decisão principal)

**Recomendo: o motor NUNCA apaga por padrão. Nem no cron, nem no backfill manual.** A remoção passa a exigir **flag explícita** na chamada.

**Por quê — assimetria do erro (a mesma lógica da armadilha 25, aplicada à deleção):**

| erro | como se manifesta | detectabilidade |
|---|---|---|
| apagar doc que deveria ficar | despesa **some**, total cai um pouco | **invisível** — ninguém questiona número menor |
| não apagar doc que deveria sair | duplicata permanece, total **sobe** | **visível** — o valor destoa e alguém pergunta |

Quando os custos são assimétricos, **o default seguro é o que erra na direção visível**. É a mesma decisão que o Pedro impôs no `DEFAULT false` do `em_controle` — e que se provou certa em 24h.

**Reforço empírico (D-013):** a causa dominante de órfão **não é cancelamento no Alvo** — é **renumeração** (o Alvo re-emite com sufixo e gera `chave_docfin` nova) ou **listagem parcial**. Apagar automaticamente é apostar que a listagem daquele instante é a verdade, três vezes por dia, sem testemunha.

**Custo de não apagar:** órfãos-duplicata permanecem contados e inflam o total. **É um custo aceitável porque é visível e mensurável** — a tabela de quarentena vira a fila de trabalho para o Pedro decidir em lote, com evidência de gêmeo. Hoje esse mesmo custo existe *invertido e invisível*.

**Política proposta, por modo:**

| modo | detecta | grava snapshot | apaga |
|---|---|---|---|
| **cron** (automático, 3×/dia) | ✅ | ✅ | ❌ **nunca** |
| **manual sem flag** (default) | ✅ | ✅ | ❌ |
| **manual com `permitir_remocao_orfaos=true`** | ✅ | ✅ | ✅ (respeitando o teto atual) |

A trava de teto **continua valendo por cima** da flag: com a flag ligada e órfãos acima do teto, ainda aborta.

---

## 2. DDL — tabela de quarentena (Supabase; **exige aprovação do Pedro**)

Não é só log de deleção: é **quarentena com histórico**, um registro por documento órfão, atualizado a cada detecção.

```sql
create table if not exists public.desp_docfin_orfaos (
  id                    uuid primary key default gen_random_uuid(),

  -- identificação
  codigo_empresa_filial text        not null,
  chave_docfin          bigint      not null,
  competencia           date        not null,           -- dia 1, como desp_docfin_competencias
  ano                   integer     not null,           -- ano/mes do rateio (armadilha 24)
  mes                   integer     not null,

  -- dados de negócio (desnormalizados para consulta sem abrir o json)
  especie               text,
  numero                text,
  codigo_entidade       text,
  nome_entidade         text,
  valor_documento       numeric,
  valor_rateio_total    numeric,                        -- o que sai do total se for removido
  n_rateios             integer,
  data_emissao          date,
  codigo_situacao       text,
  sync_em_original      timestamptz,                    -- o sync_em que o marcou como órfão

  -- SNAPSHOT COMPLETO (é isto que torna a deleção reversível)
  doc_json              jsonb       not null,           -- to_jsonb(desp_docfin_doc), inclui payload_alvo
  rateios_json          jsonb,                          -- array de to_jsonb(desp_docfin_rateio)

  -- ciclo de vida
  status                text        not null default 'DETECTADO',
    -- DETECTADO | REMOVIDO | RESTAURADO | IGNORADO
  primeira_deteccao_em  timestamptz not null default now(),
  ultima_deteccao_em    timestamptz not null default now(),
  n_deteccoes           integer     not null default 1,
  removido_em           timestamptz,
  removido_por          text,                           -- 'cron' | 'manual' | user
  restaurado_em         timestamptz,
  origem_rodada         text,                           -- 'cron' | 'manual_admin' | etc
  observacao            text,

  -- análise de gêmeo (preenchida por rotina/agente, não pelo motor)
  tem_gemeo             boolean,
  gemeo_fonte           text,                           -- 'movestq' | 'docfin'
  gemeo_ref             text,                           -- ex.: 'chave_movestq=17290 NFS-e 32'

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_desp_docfin_orfaos unique (codigo_empresa_filial, chave_docfin)
);

create index if not exists ix_desp_orfaos_comp    on public.desp_docfin_orfaos (ano, mes);
create index if not exists ix_desp_orfaos_status  on public.desp_docfin_orfaos (status);
create index if not exists ix_desp_orfaos_remov   on public.desp_docfin_orfaos (removido_em desc);

alter table public.desp_docfin_orfaos enable row level security;  -- sem policies: acesso só via RPC SECURITY DEFINER (armadilha 2)
```

**Notas de desenho:**

* **`unique (filial, chave_docfin)`** — um registro por documento. O cron faz **upsert**, incrementando `n_deteccoes` e atualizando `ultima_deteccao_em`. Sem isso, 3 rodadas/dia × 3 competências geraria lixo em volume.
* **O snapshot é gravado na DETECÇÃO, não na remoção.** É o ponto crítico: quando o doc é detectado como órfão ele **ainda existe**; se a gravação esperasse a remoção, qualquer caminho alternativo de deleção perderia o dado.
* **`doc_json` inclui `payload_alvo`** (~15–16 KB/doc). Volume estimado: junho teve 31 órfãos ⇒ ~0,5 MB. Irrelevante.
* **Nunca há expurgo automático.** Diferente do log do Render, que expira.

---

## 3. Mudança no motor (`docfin-despesas`, erp-proxy)

Na etapa em que hoje a trava identifica órfãos e decide apagar:

```
para cada doc órfão detectado (presente no banco, ausente da listagem da rodada):

  1. Monta o snapshot:
       doc_json     = registro completo de desp_docfin_doc (com payload_alvo)
       rateios_json = todos os desp_docfin_rateio do chave_docfin
       valor_rateio_total = soma de valor_brl
       ano/mes = do rateio (NUNCA de data_competencia — armadilha 24)

  2. UPSERT em desp_docfin_orfaos
       ON CONFLICT (codigo_empresa_filial, chave_docfin) DO UPDATE
         SET ultima_deteccao_em = now(),
             n_deteccoes        = desp_docfin_orfaos.n_deteccoes + 1,
             doc_json           = excluded.doc_json,      -- refresca o snapshot
             rateios_json       = excluded.rateios_json,
             updated_at         = now()
       -- status NÃO é sobrescrito no update (preserva REMOVIDO/IGNORADO/RESTAURADO)

  3. SE permitir_remocao_orfaos != true:
        NÃO apaga. Loga ORFAO_DETECTADO. Segue.

     SE permitir_remocao_orfaos == true:
        a. Verifica o teto atual: n_orfaos > max(25; 30% dos docs no banco) -> ABORTA (comportamento atual, mantido)
        b. Dentro de UMA TRANSAÇÃO:
             - confirma que o registro em desp_docfin_orfaos existe e tem doc_json não-nulo
             - DELETE dos rateios; DELETE do doc
             - UPDATE desp_docfin_orfaos SET status='REMOVIDO', removido_em=now(),
                      removido_por=<origem>, origem_rodada=<origem>
           Se QUALQUER passo falhar -> ROLLBACK completo (não apaga)
        c. Loga ORFAO_REMOVIDO com chave, valor_rateio_total e id da auditoria
```

**Invariante estrutural:** *nenhum documento é apagado sem que exista, já commitado, um registro em `desp_docfin_orfaos` com `doc_json` não-nulo.* A verificação é feita **dentro da transação** — não é confiança, é checagem.

**Propagação da flag:** `permitir_remocao_orfaos` chega ao proxy pela chamada da Edge Function, que a recebe de quem dispara. Default **`false`** em todos os caminhos — cron, chamada direta, retomada de offset. Explicitar sempre, nunca herdar do default (mesma disciplina do `em_controle`, armadilha 25).

**Contadores do `summary`:** somar `orfaos_detectados`, `orfaos_removidos`, `orfaos_em_quarentena` — hoje o resultado da limpeza não aparece de forma auditável em `sync_runs`.

---

## 4. Consumo (fora do escopo do proxy, para depois)

* **RPC de leitura** `desp_listar_orfaos(ano, mes, status)` — `SECURITY DEFINER` com gate `user_has_permission` (regra do módulo). Alimenta o D-009 e o D-013 com evidência real em vez de investigação do zero a cada vez.
* **RPC de restauração** `desp_restaurar_orfao(chave_docfin)` — reinsere doc + rateios a partir do `doc_json`/`rateios_json`, marca `status='RESTAURADO'`. `SECURITY DEFINER`, gate de admin. **Só depois que a tabela existir e tiver histórico** — não é urgente.
* Aba de revisão na tela, se e quando o volume justificar. Provavelmente não justifica: é fila de exceção, não de rotina.

---

## 5. Ordem de implantação (cada passo reversível)

1. **DDL da tabela** (Supabase, aprovação do Pedro). Isolado, aditivo, não afeta nada em produção.
2. **Proxy: gravar o snapshot + parar de apagar** (`permitir_remocao_orfaos` default `false`). Deploy fora das janelas do cron (07h30 / 12h30 / 16h30 BRT) ou com kill-switch.
3. **Observar 1–2 dias.** Conferir que a quarentena enche com o esperado e que nada mais é apagado.
4. **Só então** habilitar a flag para rodadas manuais de backfill.

**Rollback:** o passo 2 é reversível por deploy anterior; o passo 1 por `drop table` (a tabela é isolada, sem FK de outras tabelas apontando para ela).

---

## 6. Efeito colateral positivo

Com a quarentena preenchida, **o D-009 e o D-013 deixam de ser investigação arqueológica**. Hoje, para saber se um órfão tinha gêmeo, é preciso reconstruir o passado por inferência. Com a tabela, cada órfão chega com snapshot completo e os campos `tem_gemeo`/`gemeo_ref` prontos para receber a análise — e a decisão do Pedro (`IGNORADO` vs `REMOVIDO`) fica registrada com o motivo.

E o D-015 (decompor o delta de junho) passa a ser trivial em toda competência futura: a parcela (c) do critério de aceitação lê-se direto da tabela, em vez de ser estimada por diferença.
