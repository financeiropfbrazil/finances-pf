# AJUSTE-RS-F1 — Telas legadas de Compras removidas (Notas de Serviço, Certificado, Pedidos de Compra)
### Ajuste ao `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` (BLOCO F: itens F1 e F5; referência do PROMPT C3)

> **Documento aditivo.** Não altera o plano v1.1 — ele permanece como está. Onde houver
> conflito, **este arquivo prevalece para os itens F1 e F5**.
> **Decisão:** Pedro, 15/10/2026 — as telas foram substituídas pelo módulo Suprimentos.
> **Base factual:** banco `hbtggrbauguukewiknew` em 15/10/2026 (MCP read-only) + leitura do código.

---

## 1. O que saiu do frontend

| Commit | Removido | Por quê |
|---|---|---|
| `b2331f2` | `/compras/notas-servico` (`ComprasNotasServico.tsx`, `comprasNfseService.ts`, `alvoMovEstqLancarService.ts`, `danfseGeneratorService.ts`, `VincularPedidoDialog.tsx`, `ConfirmarLancamentoModal.tsx`) e `/compras/certificado` (`ComprasCertificado.tsx`) | Captura de NFS-e parada desde 08/04/2026; só 1 NFS-e lançada no Alvo por essa via (06/04). O certificado A1 e a senha ficavam no `localStorage`. |
| este | `/compras/pedidos-compra` (`ComprasPedidosCompra.tsx`, `alvoPedCompService.ts`), `baixarAnexoPedido` em `alvoPedCompLoadService.ts` e o grupo "Compras" do menu | Substituída por Suprimentos › Pedidos. O botão "Sincronizar" não rodava desde 21/05/2026. O `sync-compras-status-cron` (pg_cron jobid 1, de hora em hora) tem um Job 3 que descobre pedidos novos no Alvo, e `compras_pedidos` recebeu de 166 a 420 pedidos novos por mês de maio a setembro sem esse botão. A chave legada `compras` não está concedida a nenhum usuário, então só o admin via o grupo. |

Junto com o `b2331f2`: a importação por e-mail de NFS-e, NFCOM e CT-e foi desligada (fica só
NF-e), e `main.tsx` apaga as chaves `sefaz_*` que tenham sobrado nos navegadores.

## 2. Efeito nos itens do plano

- **F1 — Escrita direta em Notas de Serviço.** Dos "dois services", só resta
  `alvoMovEstqLancarNfeService.ts` (NF-e, usado por `LancarNfeModal.tsx`). A rota nova no proxy
  e a validação passam a ser feitas **só com NF-e**.
- **F5 — Descomissionar credenciais.** As duas chamadas diretas a `pedComp/DownloadFile` no
  `src/` saíram: o sync de anexos do `alvoPedCompService` e `baixarAnexoPedido`. Antes de
  dar o download de anexos como zerado, confira no inventário do CDX-3 se resta outro caminho.
  O F5 continua dependendo dos demais consumidores diretos (F4).
- **PROMPT C3** citava `alvoPedCompService.ts:434-463` como referência de mapeamento. O
  arquivo não existe mais; consulte-o no histórico: `git show 2c22858:src/services/alvoPedCompService.ts`.

## 3. O que ficou no banco (intacto)

- `compras_nfse` (32 linhas, 1 lançada no Alvo) e as chaves `nfse_ult_nsu` /
  `nfse_last_query_ts` de `compras_config`.
- `pedcomp_last_sync_ts` em `compras_config`.
- `sync_jobs`: `nfse_sefaz` e `pedidos_compra`, ambos `ativo = true` e **nunca executados**.
  Ficaram sem rota em `ConfigSyncJobs` (o botão mostra "Handler não configurado"); podem
  ser desligados pelo próprio toggle da tela.

## 4. Correção de registro

O commit `b2331f2` inseriu por engano um "AJUSTE E1-A" dentro de `PLANO-REVISAO-SUPRIMENTOS.md`
(a v1.0, que deve ficar intacta) e chamou o item de E1 — na v1.1 ele é o **F1**, e o E1 é
outra coisa (drenagem automática). Este commit restaura a v1.0 ao original e o registro
passa a viver aqui.
