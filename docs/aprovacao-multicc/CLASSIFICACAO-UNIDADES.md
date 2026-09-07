# Classificação final das 171 respostas Produto/Load

Análise executada exclusivamente sobre os arquivos salvos em 07/09/2026. **Zero novas
chamadas HTTP.** `tests/classificar-cache.mjs` executou o shared da implementação,
conferiu igualdade com a cópia do gateway e ensaiou cada posição usando
`unidadesProduto`, `converterSolicitada` e `validarItemCadastro`. Exit 0.

| Medida | Resultado |
|---|---:|
| Produtos com resposta completa | 171/171 |
| Produtos com todas as unidades suportadas | 170 |
| Produtos com suporte parcial | 1 |
| Produtos inteiramente bloqueados | 0 |
| Posições de unidade por produto | 196 |
| Unidades suportadas | 194 |
| Unidades bloqueadas | 2 |
| Consultas inconclusivas | 0 |

“Unidade” aqui é o par produto/posição; códigos iguais em posições distintas contam
separadamente. Todos os 171 produtos têm pelo menos uma unidade suportada. Não foi
alterada a regra de conversão nem foi aplicado fator inferido para Divisor.

## Bloqueios encontrados

Somente o produto **001.017.092** tem unidades bloqueadas:

| Unidade | Posição | Peso | Tipo | Usada no recorte recente? | Marcada para compras? | Resultado |
|---|---:|---:|---|---|---|---|
| UNID | 1 | 1 | Fator | Sim: 1 item/1 requisição | Não | Suportada |
| M3 | 2 | 10 | Divisor | Não | Não | Bloqueada |
| M3 | 3 | 10 | Divisor | Não | Sim | Bloqueada |

Motivo exato: `CONVERSAO_NAO_COMPROVADA: Divisor exige Produto/Load e Insert nativo`.
Não houve bloqueios por dimensões/dependência, base não normalizada ou outro motivo
nas 171 respostas, conforme o validador atual e o ensaio realizado.

O wizard sugere a única unidade marcada para compras: nesse produto, **M3 posição 3**.
Essa sugestão agora exibe aviso inline e impede avançar/adicionar antes da tentativa
(correção de apresentação posterior à classificação, sem alterar o validador). UNID continua utilizável
quando essa for a unidade efetivamente pretendida pelo requisitante; não converter
silenciosamente uma solicitação em M3 para UNID para contornar o bloqueio.

## Impacto sobre histórico e unidades de compras

Os **171 pares produto/código de unidade usados nos 363 itens recentes** encontraram
uma única posição correspondente no cadastro atual, suportada pelo validador. Nenhum
par usado caiu nas unidades bloqueadas; zero códigos ausentes ou ambíguos nesse recorte.
Isso não reconstrói a posição histórica: ela permanece ausente no espelho original,
e as quantidades solicitadas originais exigem ReqComp/Load quando incompletas.

Há **41 posições marcadas para compras: 40 suportadas e 1 bloqueada** (M3 posição 3).
Elas estão em 39 produtos. **132 produtos não têm marca de compras** e **2 têm duas**:

| Produto | Posições marcadas para compras | Resultado |
|---|---|---|
| 001.013.00551 | UNID/1 e PACOTE/2 | Ambas suportadas |
| 001.016.019 | UNID/1 e PC/2 | Ambas suportadas |

Ausência ou duplicidade da marca de compras não é incompatibilidade de conversão.
O wizard atual usa a posição 1 quando não há uma única marca; conferir essa seleção
no aceite, sem assumir uma preferência de compras que o cadastro não define.

## Limites e pendências concretas para o Alvo real

1. **Divisor identificado:** para habilitar M3 do produto 001.017.092, obter captura de
   criação nativa com a unidade/posição selecionada, quantidade digitada e request/response
   de `ReqComp/SavePartial?action=Insert`, incluindo CodigoProdUnidMed, PosicaoProdUnidMed,
   Quantidade2 e QuantidadeProdUnidMedPrincipal. Cobrir posições 2 e 3, pois repetem M3
   mas são registros distintos. O Produto/Load já está salvo; não basta para inferir a
   fórmula. Nenhum Insert foi executado nesta análise. Até comprovação, manter bloqueio.
2. **Aceite Fator efetivo:** executar posteriormente, sob autorização, o fluxo completo
   com 001.013.00382, UNID/2, solicitadas 10 e 20, principais 1 e 2, incluindo multipart,
   resposta e ReqComp/Load final. Os testes locais e a captura nativa fornecida não são
   prova de um envio real desta nova entrega.
3. **Identidades e CCs:** preencher a matriz R/LA/LA2/LB/LC/X/ADM e os códigos A/B/C
   do roteiro `ACEITE-ALVO.md`, usando não-admin nos casos comuns. Conferir logins Alvo,
   permissões e lideranças existentes. Fechar critérios para CC sem líder e exceção admin.
4. **Seleção de unidade:** conferir ausência/múltiplas marcas de compras e a sugestão
   bloqueada de M3/3; não alterar cadastro ou escolher outra unidade por suposição.
5. **Implantação e recuperação:** realizar somente em etapa autorizada, coordenando SQL,
   gateway, Edge e frontend, PREVIEW/VERIFY e janela operacional do roteiro. Render Live
   76f67b2 foi confirmado pelo usuário; reconfirmar antes da janela se houve novo deploy.
6. **Histórico e precisão:** recuperar ReqComp/Load original para clones incompletos.
   “Suportada” significa que o formato passou com solicitada=1; a quantidade concreta
   ainda deve passar pelo limite numeric/9 casas. Dimensões, base alternativa e regra
   de arredondamento continuam sem contrato geral, embora não tenham causado bloqueio
   neste conjunto. Não ampliar suporte fora da evidência.

Reprodução sem rede: `node docs/aprovacao-multicc/tests/classificar-cache.mjs`.
Detalhes de todos os produtos, hash de cada resposta e hash do validador em
`produto-load/analise-offline.json`; tabela completa em `produto-load/unidades.csv`.
Respostas originais e relatório da coleta foram preservados.
