

## Análise do Estado Atual

O OFX já é salvo no banco (`bank_statement_transactions`) quando importado, e recarregado ao trocar de período. **Porém**, o salvamento é feito por `period_id` apenas — sem distinção de conta bancária (`selectedBank`). Isso significa que se você importar o OFX do Santander e depois do Bradesco no mesmo mês, o segundo sobrescreve o primeiro.

## Problema Central

A tabela `bank_statement_transactions` não possui coluna de **conta bancária**. Precisamos segregar OFX por conta + período.

## Plano de Implementação

### 1. Migração: adicionar coluna `bank_code` à tabela `bank_statement_transactions`

- `ALTER TABLE bank_statement_transactions ADD COLUMN bank_code text NOT NULL DEFAULT '';`
- Mesma lógica para `erp_transactions`: `ALTER TABLE erp_transactions ADD COLUMN bank_code text NOT NULL DEFAULT '';`
- Isso permite que cada conta tenha seu próprio extrato OFX e dados ERP salvos separadamente no mesmo período.

### 2. Refatorar `saveOfxToDb` e `loadSavedOfx`

- O `DELETE` e `INSERT` passam a filtrar por `period_id` **E** `bank_code`.
- O `SELECT` de carga idem: `where period_id = X AND bank_code = Y`.
- Resultado: ao trocar de banco no dropdown, carrega o OFX correto daquela conta.

### 3. Refatorar `saveErpToDb` e `loadSavedErp`

- Mesmo tratamento: filtrar por `bank_code` (o `selectedBank`/`CodigoTipoPagRec`).

### 4. Recarregar dados ao trocar de banco

- O `useEffect` que dispara `loadSavedOfx` + `loadSavedErp` deve depender também de `selectedBank`, não só de `activePeriodId`.

### 5. Comportamento de sobrescrita

- Quando o usuário importa um novo OFX para a mesma conta+período, o sistema deleta os anteriores e grava os novos (já funciona assim, só precisa do filtro de banco).
- Quando mês está fechado (`monthClosed`), bloqueia importação e sync (já funciona).

### 6. Sugestões de UX para o fluxo ideal

- **Indicador visual** no dropdown de banco mostrando quais contas já têm OFX importado para o mês selecionado (ex: badge "OFX ✓" ao lado do nome).
- **Toast de confirmação** ao sobrescrever: "Substituir o extrato existente do Santander em Jan/2026? (X lançamentos serão substituídos)".
- **Fechamento por conta**: considerar fechar a conciliação individualmente por conta bancária em vez de fechar o mês inteiro de uma vez. Isso permite que o Santander seja fechado enquanto o Bradesco ainda está em aberto.

---

### Resumo Técnico

| Artefato | Mudança |
|---|---|
| **Migration SQL** | Adicionar `bank_code` em `bank_statement_transactions` e `erp_transactions` |
| **CashBanks.tsx** | Filtrar save/load por `bank_code`; reagir a mudança de `selectedBank`; toast de sobrescrita |
| **BankStatementTable.tsx** | Sem mudanças estruturais |

Essa arquitetura garante que cada conta bancária tenha seus dados isolados por período, e a importação de um novo OFX sempre sobrescreve apenas o da mesma conta.

