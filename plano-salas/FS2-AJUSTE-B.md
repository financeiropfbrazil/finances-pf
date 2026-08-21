# FS2 · AJUSTE B — MVP de três eventos (entrada · refugo · saída)

**Criado em:** 21/08/2026 · **Origem:** decisão do Pedro em conversa, após a FS2 fechada (SESSÃO S3)
**Escopo:** ajusta a fase FS2 **sem desfazer nada**. Nenhuma tabela é dropada, nenhuma função é
removida, nenhuma coluna é excluída.

> Regra de imutabilidade do `PLANO-SALAS.md` respeitada: o `FS2-MOVIMENTO.md` permanece
> **intacto**, inclusive na parte que este ajuste desativa. Correções entram como arquivo novo.

---

## §A — O que mudou e por quê

A FS2 foi especificada com **batelada** como espinha dorsal (abrir → declarar consumo → fechar),
para que o saldo de insumo da sala fechasse mesmo sem receita (BOM) no Alvo.

**O Pedro esclareceu o escopo do MVP:** não há controle de estoque de sala, não há vínculo
RM × entradas, e não há nenhuma conexão com o Alvo em tempo real. O MVP é **registro de
movimentação puro, 100% no banco do Hub**: o operador seleciona um item que existe na sala e
registra o evento.

**Consequência:** sem controle de saldo, a batelada perde a razão de ser. O MVP volta ao desenho
original de **três eventos independentes**:

```
ENTRADA  →  REFUGO  →  SAÍDA
```

Cada evento registra: item (dos vinculados à sala), quantidade, unidade, lote, operador
(`auth.uid()`), timestamp de servidor — e é imutável (correção = soft-estorno).

### A.1 O que fica dormindo (NÃO usar, NÃO dropar)

Estes objetos da FS2 continuam existindo no banco, **sem uso no MVP**. Ficam prontos caso o
controle de saldo/genealogia seja retomado no futuro:

| Objeto | Situação |
|---|---|
| `prod_bateladas` | dormindo |
| `prod_batelada_consumos` | dormindo |
| `prod_vw_saldo_insumos` | dormindo |
| `prod_abrir_batelada` | dormindo |
| `prod_declarar_consumo` | dormindo |
| `prod_fechar_batelada` | dormindo |
| permissão `salas.batelada.manage` | permanece no catálogo, sem uso na UI |

⚠️ **Nada disso é dropado, revogado ou alterado.** Dormir é a instrução; remover não é.

### A.2 O que sai do desenho (registrado para não voltar por engano)

- Consumo declarado de insumo (a pergunta §F.2 do FS2-MOVIMENTO deixa de existir no MVP).
- Saldo de sala, rendimento por rodada, gramas por peça, genealogia lote-a-lote.
- Numeração automática `PT-AAMMDD-NN` e a regra "um lote aberto por sala".
- Dropdown de lote alimentado por `op_reqmat_lotes` (espelho de RM) — **fora do MVP**. O lote é
  campo livre nas RPCs; a origem (livre ou lista) é decisão de UI na FS3.

---

## §B — Tarefas (adicionar ao Quadro de Status §3 do plano)

| Fase | Tarefa | Descrição |
|---|---|---|
| FS2B | FS2B-0 | Pré-voo do ajuste (leituras) |
| FS2B | FS2B-1 | `prod_saidas.batelada_id` → opcional (DROP NOT NULL) |
| FS2B | FS2B-2 | RPC `prod_registrar_saida` |
| FS2B | FS2B-3 | `NOTIFY pgrst` + verificação final |

---

## §C — SQL do ajuste

### FS2B-0 — Pré-voo (somente leitura)

```sql
-- (a) esperado: batelada_id com is_nullable = 'NO' (é o que este ajuste vai mudar)
select column_name, is_nullable, data_type
  from information_schema.columns
 where table_schema='public' and table_name='prod_saidas'
 order by ordinal_position;

-- (b) esperado: 0 linhas — nenhuma saída registrada ainda (o MVP nunca rodou)
select count(*) as saidas from public.prod_saidas;

-- (c) esperado: prod_registrar_saida NÃO existe ainda
select proname from pg_proc where proname = 'prod_registrar_saida';

-- (d) esperado: 1 linha — o produto PRODUTO da sala PONTEIRAS (Sub Assembly A)
select p.codigo_alvo, p.nome_curto, p.unidade_base, p.controla_lote
  from public.prod_sala_produtos sp
  join public.prod_produtos p on p.id = sp.produto_id
  join public.prod_salas s on s.id = sp.sala_id and s.codigo='PONTEIRAS'
 where sp.papel = 'PRODUTO';
```

Divergência em qualquer uma → **PARAR** e reportar. Em especial: se (b) devolver linhas, existe
saída gravada e o ajuste precisa ser reavaliado antes de mexer na coluna.

---

### FS2B-1 — `batelada_id` passa a ser opcional

> ALTER **não destrutivo**: apenas remove a obrigatoriedade. A coluna, a FK e os dados
> permanecem. Saídas futuras podem ou não apontar para uma batelada.

```sql
alter table public.prod_saidas alter column batelada_id drop not null;
```

```sql
-- esperado: batelada_id agora com is_nullable = 'YES'
select column_name, is_nullable from information_schema.columns
 where table_schema='public' and table_name='prod_saidas' and column_name='batelada_id';
```

---

### FS2B-2 — RPC `prod_registrar_saida`

Mesmo padrão de `prod_registrar_entrada` (FS2-8) e `prod_registrar_refugo` (FS2-10):
gate por sala, produto tem que ser `PRODUTO` da sala, unidade validada contra
`escala_unidades`, conversão gravada em `quantidade_base` + `fator_usado`, operador de
`auth.uid()`, timestamp de servidor.

**Diferenças em relação à saída antiga (fechamento de batelada):**
- `p_batelada_id` é opcional e default `NULL` (no MVP, sempre NULL);
- `p_lote_producao` é **informado pelo operador** (campo obrigatório, texto livre nesta fase —
  a origem do número ainda será investigada pelo Pedro);
- não há validação de formato do lote: qualquer texto não-vazio é aceito.

```sql
create or replace function public.prod_registrar_saida(
  p_sala_id uuid, p_produto_id uuid, p_quantidade numeric, p_unidade text,
  p_lote_producao text, p_batelada_id uuid default null, p_observacao text default null,
  p_data_movimento timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_prod record; v_peso numeric; v_id uuid;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;
  if not public.user_has_sala_permission(v_uid, p_sala_id, 'salas.registrar.saida') then
    raise exception 'Sem permissão para registrar saída nesta sala';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida'; end if;
  if p_lote_producao is null or btrim(p_lote_producao) = '' then
    raise exception 'Lote de produção é obrigatório';
  end if;

  select p.* into v_prod from public.prod_produtos p where p.id = p_produto_id and p.ativo;
  if not found then raise exception 'Produto inexistente ou inativo'; end if;

  if not exists (select 1 from public.prod_sala_produtos sp
                 where sp.sala_id = p_sala_id and sp.produto_id = p_produto_id and sp.papel = 'PRODUTO') then
    raise exception 'Produto não é produto desta sala';
  end if;

  select (u->>'peso')::numeric into v_peso
    from jsonb_array_elements(v_prod.escala_unidades) u where u->>'unidade' = p_unidade;
  if v_peso is null then raise exception 'Unidade % não existe na escala do produto', p_unidade; end if;

  if p_batelada_id is not null then
    if not exists (select 1 from public.prod_bateladas b
                   where b.id = p_batelada_id and b.sala_id = p_sala_id) then
      raise exception 'Batelada inexistente ou de outra sala';
    end if;
  end if;

  insert into public.prod_saidas
    (sala_id, batelada_id, produto_id, quantidade, unidade, quantidade_base, fator_usado,
     lote_producao, observacao, registrado_por, data_movimento)
  values
    (p_sala_id, p_batelada_id, p_produto_id, p_quantidade, p_unidade,
     p_quantidade * v_peso, v_peso, btrim(p_lote_producao),
     nullif(btrim(p_observacao),''), v_uid, p_data_movimento)
  returning id into v_id;
  return v_id;
end;
$$;
```

```sql
revoke execute on function public.prod_registrar_saida(uuid, uuid, numeric, text, text, uuid, text, timestamptz) from public;
revoke execute on function public.prod_registrar_saida(uuid, uuid, numeric, text, text, uuid, text, timestamptz) from anon;
grant  execute on function public.prod_registrar_saida(uuid, uuid, numeric, text, text, uuid, text, timestamptz) to authenticated;
```

---

### FS2B-3 — Fechamento

```sql
NOTIFY pgrst, 'reload schema';
```

```sql
-- (1) esperado: batelada_id nullable = YES
select column_name, is_nullable from information_schema.columns
 where table_schema='public' and table_name='prod_saidas' and column_name='batelada_id';

-- (2) esperado: 7 funções do módulo, proacl SEM anon em todas
select proname, pg_get_function_identity_arguments(oid) as args, proacl
  from pg_proc
 where proname in ('prod_registrar_entrada','prod_registrar_refugo','prod_registrar_saida',
                   'prod_estornar_movimento','prod_abrir_batelada','prod_declarar_consumo',
                   'prod_fechar_batelada')
 order by proname;

-- (3) esperado: as 10 tabelas do módulo seguem com rowsecurity = true e SÓ policies de SELECT
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename like 'prod\_%' order by 1, 3;

-- (4) esperado: 11 motivos de refugo, 6 ainda provisórios
select aplica_a, count(*) filter (where provisorio) as provisorios, count(*) as total
  from public.prod_sala_motivos_refugo group by aplica_a order by 1;
```

---

## §D — Como testar

Continua valendo o **§D do `FS2-MOVIMENTO.md` integralmente**: as RPCs **não podem ser testadas
pelo MCP** (conexão não autenticada, `auth.uid()` = NULL). "Sessão não autenticada" é
comportamento correto, não falha. O agente verifica **estrutura**, não execução, e não contorna
o gate de nenhuma forma.

O teste funcional é humano — pela UI na FS3, ou pelo Pedro via console do navegador com sessão
real. Roteiro do MVP (três eventos):

1. registrar **entrada** de um insumo com lote e validade futura → deve gravar;
2. registrar **entrada** com validade passada → deve falhar com a mensagem de bloqueio;
3. registrar **refugo** de insumo e de peça, com motivo de cada tipo → o motivo de peça em item
   de insumo (e vice-versa) deve falhar;
4. registrar **saída** com lote de produção → deve gravar; sem lote → deve falhar;
5. **estornar** um registro próprio dentro de 60 minutos → deve passar; simular fora da janela →
   deve exigir `salas.estornar`.

---

## §E — Critério de aceite do Ajuste B

As 4 verificações da FS2B-3 batendo com o esperado, DIARIO com uma entrada por tarefa, Quadro de
Status atualizado, commits por tarefa e push feito.

## §F — Decisões registradas nesta conversa (contexto, sem ação para o agente)

1. **Rótulo na UI:** o que o banco chama de `batelada` a sala chama de **"Lote"**. No MVP isso é
   irrelevante (a batelada não é usada); na FS3, o campo `lote_producao` da saída aparece como
   **"Lote"** — e, se houver ambiguidade com o lote do material, usar **"Lote de produção"**.
2. **Origem do número do lote de produção:** desconhecida. Não é o lote de produto do Alvo. O
   Pedro vai investigar. Até lá: campo obrigatório, texto livre.
3. **Tabelas legadas `prod_*` de teste:** dropadas pelo Pedro em 21/08/2026 (eram do fluxo de
   Válvulas/pericárdio, não do piloto). Isso **fecha o §7.3 do plano** e o buraco de escrita
   apontado na SESSÃO S3 (policies `FOR ALL TO authenticated USING (true)`). Restam 10 tabelas
   `prod_*`, todas com RLS e apenas policies de SELECT.
4. **Motivos de refugo de insumo (§F.1 da FS2):** seguem `provisorio = true`, aguardando
   validação com a sala. Os 12 motivos da tabela legada eram de pericárdio (curvatura do
   folheto, delaminação, gordura, vasos) — **não se aplicam** à ponteira.
5. **Ideia acolhida da tabela legada:** o motivo "Outro" com `exige_observacao = true` é bom
   padrão (evita o campo virar lixo). Se o Pedro confirmar, entra como Ajuste C: coluna
   `exige_observacao` em `prod_sala_motivos_refugo` + validação na RPC de refugo. **Não
   implementar sem ordem expressa.**
