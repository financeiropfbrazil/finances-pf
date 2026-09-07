# Correção do aceite: seletores e consulta de unidades — 07/09/2026

Frontend preparado como multicc-20260907-aceite-2. Sem alteração SQL, Edge ou gateway,
sem Insert de teste no Alvo. SELECT confirmou modo aceite, quatro participantes,
cron jobid 1 inativo e sync_settings.enabled=false. Lideranças preservadas.

## Achados comprovados e limite da investigação

O componente publicado em bb6e771 usava select nativo, sem cores semânticas. Com
carregando=true e unidades=[], ficava disabled sem status, aviso ou ação. O snapshot
real do componente foi reproduzido por teste em seletor-antes-aceite.tsx. A consulta
HTTP não tinha prazo máximo e React Query podia repetir buscas/refazer ao focar a
janela. Isso reproduz o sintoma em rede pendente; **não prova a causa específica do
Produto/Load de 001.001.00051 em produção**.

Fluxo conferido: carregarUnidadesProduto → GET /produto/load?codigo=... → gateway
Produto/Load?codigo=...&loadChild=All → resposta → unidadesProduto → estado/seleção.
Gateway devolve o corpo recebido e distingue erros HTTP. Não foi alterado.

001.001.00051 consta ativo em stock_products: DRYPATCH - MEMBRANA DESIDRATADA DE
PERICÁRDIO BOVINO 12.0 X 18.0 CM, unidade textual UNID. Não há Load salvo desse código
entre os 171. O texto UNID não prova posição, fator, compras ou resposta atual.
Não foi inventada conversão e não foi classificado como incompatível.

**Evidência ainda necessária:** status HTTP e corpo da resposta do GET
/produto/load?codigo=001.001.00051 na sessão autenticada do Hub; se não terminar,
registrar Pending/duração. Não compartilhar Authorization, cookies ou tokens.
A pergunta foi apresentada ao usuário durante o trabalho. Até obter a resposta,
a validação funcional real desse produto permanece pendente.

## Correção

- Select/SelectTrigger/SelectContent/SelectItem do próprio Hub para unidade, CC do
  item, classe e CCs do rateio. Mesmos tokens dos temas, menus e foco por teclado.
- Carregamento explícito, spinner, ausência de produto, conexão pausada, erro com
  Tentar novamente e lista vazia explícita. Resposta sem lista tem mensagem própria.
- Prazo máximo de 45 segundos somente para a consulta de unidades, incluindo leitura
  da resposta; aborta o transporte. Troca de produto cancela a consulta anterior.
  Não altera timeouts de envio/Insert nem permite retry automático de escrita.
- Sem tentativas automáticas ocultas; refetch por foco desativado e cache de leitura
  de 60s. Criação e gateway continuam conferindo cadastro pelo contrato existente.
- Seleciona uma única unidade de compras, inclusive se bloqueada (explica o bloqueio).
  Sem unidade de compras, seleciona automaticamente apenas uma única unidade válida.
  Havendo alternativas, exige escolha. Preserva posição selecionada ao editar.
- Quantidade solicitada/principal, unidade, posição e conversão permanecem pelo
  validador original. M3/3 de 001.017.092 continua marcada e bloqueada; nunca troca
  por UNID automaticamente. Formatos suportados não foram ampliados.

## Validação executada

- Suíte de regressão: 120 testes passaram; sidebar excluído pelas sete falhas antigas.
  Depois, reprodução adicional do componente anterior passou na suíte de cinco
  testes de aviso. Testes de HTTP/timeout/lista ausente e type-check ao final.
- Produto do aceite, Load real salvo 001.013.00382: UNID/2 automática, 10→1 e 20→2
  confirmados no serviço, DOM e navegador. Sem escrita no Alvo.
- Chrome headless com perfil temporário isolado, somente Vite em 127.0.0.1. Capturas
  inspecionadas nos temas claro/escuro, menus abertos por teclado, retry funcionando.
  Código real dos componentes; falhas/pendência de rede simuladas e identificadas.
- Contraste medido com cores computadas: mínimo 15,00:1 no claro e 11,86:1 no escuro
  para seletores ativos, mensagens e superfície de menu. Campos disabled têm mensagem
  explicativa com contraste normal. Evidências: tests/visual/*.png e resultados.json.
- Type-check e build aprovados; avisos anteriores de bundle/imports/Browserslist.
  Nenhum teste visual autenticado de 001.001.00051 foi declarado como executado.

## Publicação e repetição do aceite

Após push, o responsável precisa Publish → Update no projeto correto do Lovable.
Confirmar /multicc-version.json como multicc-20260907-aceite-2 e JS com as mensagens
novas. Não basta push. Manter cron e operação geral suspensos.

Repetir inicialmente somente seleção de produto/unidade, sem submeter: observar
carregamento de 001.001.00051, registrar eventual erro e resposta HTTP, testar nova
tentativa. Para 001.013.00382 confirmar UNID/2 e quantidades 10→1/20→2; conferir CCs
nos dois temas. O aceite de aprovação/envio continua sendo executado pelo usuário.
