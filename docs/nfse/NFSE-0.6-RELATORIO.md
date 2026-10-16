# NFSE-0.6 — Cobertura do ADN × NFS-e lançadas no Alvo

**Data:** 16/10/2026 · **Base:** fila do ADN drenada até o fim no mesmo dia (1.645 documentos, NSU 1–1.645) ×
espelho do contas a pagar do Alvo (`fin_parcelas_pagar`, sincronizado às 06h40). **Só leitura.**
**SQL:** [NFSE-0.6-medicao.sql](NFSE-0.6-medicao.sql) (blocos A–F, reexecutáveis).

> **Pergunta (D1):** um importador único pelo ADN recebe as NFS-e dos nossos fornecedores, ou alguma prefeitura
> importante exige integração própria?
>
> **Resposta:** o ADN cobre **94,5%** das NFS-e lançadas no Alvo de janeiro a setembro (995 de 1.053) e **175 dos
> 188 fornecedores**. **Rio Preto: 95,4%**, dentro do critério. **São Paulo: 92,9%**, abaixo do critério. A
> investigação mostra que as faltas de São Paulo são de fornecedores e notas específicos, e não da prefeitura:
> São Paulo transmite toda semana, com cerca de 1 dia de atraso.
>
> **Recomendação: confirmar D1** — importador único pelo ADN, **sem integração com prefeitura**. A tela da Fase 1
> mostra os dois sentidos da diferença, para que os ~5% fora do ADN fiquem visíveis.

---

## 1. Como foi medido

- **"No Alvo"** = NFS-e lançadas (`especie = 'NFS-e'`), uma por prestador + número. O número vem de `doc_numero`;
  o `numero` do Alvo é "NF/série-parcela".
- **"No fisco"** = NFS-e do ADN com a P&F tomadora. Inclui as filiais, porque o casamento é pela raiz 26602204.
- **Casamento:** CNPJ/CPF do prestador + número sem zeros à esquerda. **Plano B:** CNPJ + valor (±R$ 0,05) +
  emissão (±5 dias). O plano B não achou nenhuma nota a mais, ou seja, a numeração bate entre os dois lados.
- **Cidade:** do lado do Alvo, a cidade do cadastro do fornecedor; do lado do ADN, o município emissor (código IBGE).
- **Limite da medição:** o "No Alvo" só enxerga o que foi lançado como NFS-e. Uma nota que ninguém lançou só
  aparece no sentido inverso (§4).

## 2. Cobertura (Alvo → ADN)

**Jan–set/2026** (sem o efeito de outubro, §3):

| Cidade (cadastro) | Notas no Alvo | Achadas no ADN | Cobertura | Fornecedores no ADN |
|---|---:|---:|---:|---:|
| São José do Rio Preto | 460 | 439 | **95,4%** | 69 de 73 |
| São Paulo | 282 | 262 | **92,9%** | 41 de 47 |
| Outras | 311 | 294 | 94,5% | 65 de 68 |
| **Total** | **1.053** | **995** | **94,5%** | **175 de 188** |

**Últimos 90 dias** (18/07–16/10): 318 notas, 294 achadas = **92,5%**.
- Rio Preto: 105 de 117 (89,7%).
- São Paulo: 86 de 94 (91,5%).
- Todas as outras cidades: 100%, exceto Osasco (0 de 2) e Palhoça (0 de 2). Cada uma é um fornecedor só.

**Série mensal (achadas / no Alvo):**

| Mês | Rio Preto | São Paulo | Outras |
|---|---:|---:|---:|
| jan | 43/46 | 20/21 | 25/28 |
| fev | 54/56 | 30/31 | 28/30 |
| mar | 46/49 | 26/32 | 25/27 |
| abr | 53/56 | 31/32 | 35/36 |
| mai | 58/59 | 33/33 | 25/26 |
| jun | 51/53 | 28/31 | 38/41 |
| jul | 49/51 | 31/32 | 35/37 |
| ago | 48/51 | 35/36 | 32/34 |
| set | 37/39 | 28/34 | 51/52 |
| **out (até 16/10)** | **2/9** | 4/4 | 8/8 |

## 3. As 24 faltas dos últimos 90 dias, uma a uma

| Grupo | Notas | Quem | Leitura |
|---|---:|---|---|
| **A. Rio Preto, outubro** | 5 | AQN (1), Arcontemp (2), Cia. Brasileira de Software (2) — emitidas de 01 a 05/10 | Os três fornecedores aparecem no ADN até setembro. As notas de outubro não chegaram, mas outras notas de Rio Preto de outubro chegaram (com 1 a 2 dias de atraso). **Hipótese:** atraso de repasse, ou efeito do leiaute com IBS/CBS, obrigatório desde 01/10. **Reconferir em ~23/10 (NFSE-0.7).** |
| **B. Fornecedor que nunca aparece no ADN** | 13 | iFood Benefícios/Osasco (2), H. Strattner/Palhoça (2), pessoa física/Rio Preto (3), Alegria Máquinas, Oximed e Protect EPI/Rio Preto (1 cada), Alsco Toalheiro/SP (1), Sterilex/SP (2) | O problema é do fornecedor, não da cidade: os outros fornecedores das mesmas cidades estão no ADN. Causas possíveis: emissor que não transmite, nota emitida para outro tomador, NFS-e avulsa de pessoa física, ou documento que não é NFS-e (locação, crédito de benefício) lançado como NFS-e. |
| **C. Fornecedor no ADN, sem aquela nota** | 6 | Agratto/RP (ago), Instituto Brasileiro de Pesq./SP (ago), Medlab/SP (2, set — as notas vizinhas estão no ADN), Microsoft/SP (1), VR Benefícios/SP (1, jul, R$ 48 mil) | Microsoft: o número lançado no Alvo é "21082026", que parece uma **data**, provável erro de lançamento. VR: R$ 48 mil é crédito de benefício, e as notas do VR no ADN têm valor 0,00. As demais são pontuais. |

**Leitura de São Paulo:** das 20 faltas de jan–set, 9 são de 6 fornecedores que nunca aparecem no ADN e 11 são
casos pontuais de fornecedores presentes. Uma integração com o web service da prefeitura recuperaria cerca de
2 notas por mês, e parte delas talvez nem seja NFS-e. **Não compensa.**

## 4. O sentido inverso (ADN → Alvo) — o que o importador entrega

NFS-e no ADN com a P&F tomadora, últimos 90 dias: **428**.

| | Notas |
|---|---:|
| Lançadas no Alvo como NFS-e | 294 |
| Lançada com outra espécie (DIV) | 1 |
| Canceladas no fisco e não lançadas (correto) | 11 |
| Não lançadas, emitidas há menos de 15 dias (atraso normal de lançamento) | 83 |
| **Não lançadas, emitidas há mais de 15 dias** | **39 — R$ 113.154,39** |

Por município emissor, o último grupo tem 7 notas de Rio Preto (R$ 22,8 mil), 18 de São Paulo (R$ 16,2 mil) e
14 de outras cidades (R$ 74,1 mil). São as notas que o fiscal e compras passam a ver na tela da Fase 1.

## 5. Canceladas no fisco e lançadas no Alvo (o destaque D6) — 2 casos, ambos pagos

| Prestador | NFS-e | Emissão | Valor | Lançada | Paga | Cancelada no fisco | DocFin |
|---|---|---|---:|---|---|---|---|
| MEI de Rio Preto | nº 2 | 03/03/2026 | R$ 130,00 | 27/03 | **22/04** | 01/04 (antes do pagamento) | 24896 |
| Ramos e Amato Serv. Cardiológicos (SP) | nº 3330 | 05/05/2026 | R$ 7.200,00 (R$ 6.757,20 líquido) | 06/05 | 12/05 | **15/07** (depois do pagamento) | 26294 |

Nos dois casos a P&F pagou por uma nota que hoje não existe para o fisco. As retenções declaradas e o crédito do
serviço ficam sem documento. **Decisão do fiscal e do financeiro**, fora do escopo deste plano.

## 6. Recomendação

1. **D1 confirmada:** importador único pelo ADN; nenhuma integração com prefeitura.
2. **Fase 1, a tela:** mostrar os dois sentidos com nome — "**No fisco, não no Alvo**" (§4) e
   "**No Alvo, não no fisco**" (§3, as exceções). Destacar "**cancelada no fisco, lançada no Alvo**" (§5).
3. **NFSE-0.7:** em ~23/10, drenar de novo (retoma do NSU 1.645) e reconferir as 5 notas de Rio Preto de outubro.
   Se chegarem, era atraso. Se não chegarem, investigar o leiaute com IBS/CBS antes de ligar o sync automático.
