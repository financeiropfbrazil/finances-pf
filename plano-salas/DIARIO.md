# DIARIO — Movimentação de Salas (execução do agente)

> **Append-only.** Nada é apagado ou editado; correções entram como novas entradas.
> Uma entrada por tarefa concluída, bloqueada ou falhada. Erros sempre com a mensagem literal.

## Modelo de entrada (copiar e preencher)

```
---
### [SESSÃO S? · AAAA-MM-DD HH:MM BRT] <ID da tarefa> — <título curto>
- **Status final:** concluída | bloqueada | falhou
- **O que foi executado:** (statements/migrações aplicadas, arquivos alterados)
- **Verificações:** (consulta → resultado real vs. esperado)
- **Migração/Commit:** (nome da migração MCP · hash/mensagem do commit)
- **Pendências/Sugestões:** (fora de escopo → fica aqui para o Pedro decidir)
```

---

### [SESSÃO S0 · 2026-08-20] Abertura do diário
- **Status final:** concluída
- **O que foi executado:** pasta `plano-salas/` criada com README, PLANO-SALAS, DIARIO e
  `sql/FS1-fundacao.sql`. Nenhum objeto criado no banco ainda.
- **Verificações:** —
- **Migração/Commit:** commit inicial da pasta pelo Pedro.
- **Pendências/Sugestões:** —
