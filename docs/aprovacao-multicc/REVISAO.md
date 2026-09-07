# Revisão local — 07/09/2026

Nenhuma migração ou escrita de dados em produção, push ou publicação.
Baseline e migração foram aplicados somente aos bancos locais de teste.
As regras multi-CC da entrega anterior foram preservadas.

## 1. Auditoria: reprodução antes da correção

Fonte: SELECT em `hbtggrbauguukewiknew`, fingerprint 2.038 pedidos.
DDL/policies e resultado do catálogo em `revisao-producao.json`.
A constraint real foi adicionada à `tests/fixture.sql` antes de modificar a migração.
A versão anterior está em `tests/migration-antes-revisao.sql`, somente para reprodução.

Comando executado: `node docs/aprovacao-multicc/tests/native.mjs --antes`.
Resultado esperado e observado: **exit 1**.

```text
REPRO eventos CC efetivamente gravados: []
REPRO 23514 compras_requisicoes_auditoria_evento_check ... login_servico_provisorio
REPRO 23514 compras_requisicoes_auditoria_evento_check ... envio_reivindicado
TEST_FAILURE ... auditoria silenciosamente ausente e duas falhas 23514 no envio
```

O primeiro teste sem tratamento correto do encerramento do servidor mostrou 57P01;
o runner foi corrigido para imprimir a falha original antes de encerrar o PostgreSQL.
As duas reproduções seguintes expuseram o 23514. A aprovação retornava sucesso mesmo
com eventos de CC ausentes porque `_req_evento` capturava a violação da constraint.
Os 61 testes SQL anteriores não eram evidência suficiente de compatibilidade com
produção: faltava essa constraint na fixture.

Correção: ampliar a expressão vigente da constraint por OR, preservando seu conteúdo,
e adicionar os sete eventos novos. Decisões novas usam `req_evento_obrigatorio`, privado,
sem `exception when others`. A função legada não foi alterada para outros consumidores.
Testes verificam linhas reais dos sete eventos, aceitação dos 17 eventos antigos,
recusa de evento desconhecido e rollback de status/grupos ao forçar falha na auditoria.

## 2. Anexos

Produção: bucket privado; policies permissivas SELECT, INSERT e DELETE para qualquer
authenticated nesse bucket. Nenhuma policy de UPDATE para ele. Excluir e inserir
novamente era uma forma de substituir o conteúdo sem tocar nos metadados da requisição.

A migração acrescenta guards RESTRICTIVE de INSERT/DELETE/UPDATE, com o mesmo predicado
no USING e WITH CHECK do UPDATE. Só autor ou admin com permissão de criação pode
escrever numa pasta UUID de rascunho não submetido/sem número Alvo. Não acrescenta
permissão de UPDATE: o fluxo existente usa upload `upsert:false`, e limpeza de upload
malsucedido usa DELETE. Guards não abrem nem alteram permissões de outros buckets.
O helper usa lock do pai para serializar a operação SQL com a submissão.

SHA-256 é calculado no upload, persistido no metadado e congelado. O gateway calcula
o hash dos bytes baixados e só envia o mesmo blob após a comparação. Anexo sem hash,
indisponível ou divergente impede chamada ao Alvo. Documentos submetidos preservam
hash/caminho mesmo após envio; o serviço pode apenas marcar o número do envio.
Anexos antigos de rascunho sem hash precisam ser reanexados numa cópia, sem inventar hash.

Executado: testes RLS locais como authenticated não-admin; dono limpa rascunho;
terceiro não insere/exclui; após submissão nem autor/líder/admin do app exclui;
INSERT/UPDATE/upsert recusados; hash congelado; service_role lê; DELETE concorrente
espera a submissão e reavalia a regra. Gateway real com dependências substituídas:
blob correto segue, bytes substituídos/hash ausente/arquivo indisponível não seguem.

**Continuação executada:** API HTTP do Storage real com file e S3 MinIO, incluindo
DELETE iniciado enquanto a submissão mantém o lock, e releitura dos bytes físicos.
26 verificações por backend passaram; detalhes e limites no §4 e README integrado.
Outras intercalações de upload/exclusão já em andamento não foram comprovadas por esse
cenário. O hash protege o envio contra bytes diferentes, não garante disponibilidade. Service keys permanecem uma
fronteira confiável que bypassa RLS; não são disponibilizadas ao navegador.
Referência: [controle de acesso do Storage](https://supabase.com/docs/guides/storage/security/access-control).

## 3. Unidades — contrato Fator confirmado após a primeira revisão

A primeira revisão bloqueou unidades alternativas porque o espelho não tinha escala
nem os itens da 0001480. Esse bloqueio geral foi substituído pelo suporte descrito abaixo
após o usuário fornecer `load-gpt6-1.txt` (Produto/Load real) e confirmar o Insert nativo.
A captura é lida como fixture nos testes; não é configuração hardcoded do produto.

| Unidade | Posição | Peso | Tipo | UnidadeMedidaCompras |
|---|---:|---:|---|---|
| PACOTE | 1 | 1 | Fator | Não |
| UNID | 2 | 0.1 | Fator | Sim |

O usuário confirmou request **e response** do POST ReqComp/SavePartial?action=Insert
para 0001480: item 1 = UNID/posição 2/Quantidade2 10/principal 1; item 2 = mesma unidade
posição/Quantidade2 20/principal 2. Esses valores, combinados com o Load, comprovam
`QuantidadeProdUnidMedPrincipal = Quantidade2 × Peso` neste formato Fator com base 1.
O código aplica o cadastro de cada produto; teste com outro produto/Peso 0.25 prova
que não há divisão fixa por dez nem exceção por código.

### Persistência e fluxo

- `quantidade` continua significando principal, preservando consumidores legados.
- `quantidade_solicitada` guarda Quantidade2; `posicao_prod_unid_med` guarda a posição;
  `codigo_prod_unid_med` guarda a unidade. Novas colunas nascem NULL em dados antigos.
- Criação consulta Produto/Load com JWT pelo gateway. O wizard oferece posições
  distintas mesmo se repetirem o código da unidade; usa a unidade única marcada
  para compras como sugestão, com seleção explícita disponível.
- A criação grava o Peso/tipo/código/posição conferidos em `conversao_unidade` e a tupla.
  SQL recusa tupla incompleta/divergente ou tipo diferente de Fator na submissão.
- Aprovação congela tudo; o gateway confere novamente o Produto/Load e preserva a
  tupla. Se o cadastro mudou, recusa em vez de converter de novo uma quantidade aprovada.
- O parser compartilhado preserva os campos reais de ReqComp/Load. Campos ausentes
  continuam NULL: jamais calcula Quantidade2 histórica usando cadastro atual.
- O detalhe e cron atualizam a tupla de itens existentes, mesmo sem mudança de CC;
  a atualização é permitida somente no espelho de documentos já enviados. Itens
  submetidos sem número continuam congelados; hash/caminho de anexos não são liberados.
- Clonagem de registro incompleto recupera ReqComp/Load pelo número, confere sequência
  e produto e exige os quatro campos. Rascunho sem número ou Load incompleto exige
  recriar os itens informando quantidade/unidade. Nenhum backfill inventado foi escrito.

A conversão usa aritmética decimal inteira com escala de nove casas, compatível com
numeric(18,9); não arredonda resultados fora dessa precisão. Código compartilhado em
`supabase/functions/_shared/requisicao-unidades.ts`; sua cópia no patch do gateway é
`req-unidades.ts` e deve permanecer idêntica.

### Evidência ainda necessária para outros formatos

- **Divisor**: Produto/Load completo de um produto com esse tipo e request/response
  de Insert nativo, informando quantidade digitada, código, posição, Quantidade2 e principal.
  Não inverter Peso por intuição.
- **Base posição 1 com Peso diferente de 1 ou outro tipo**: as mesmas capturas com
  pelo menos uma unidade alternativa para definir se a escala depende da base.
- **Unidade dependente/dimensional**: Load e Insert incluindo dimensões/dependências,
  valores digitados e ambos os números resultantes.
- **Resultado com mais de nove casas**: Insert/response de caso fracionário indicando
  arredondamento/truncamento e número de casas. Até lá, erro explícito, sem arredondar.
- **Histórico incompleto**: ReqComp/Load do próprio documento com os quatro campos.
  O Produto/Load sozinho não recupera a quantidade solicitada original.

Não foi executado novo Insert real ao Alvo. A prova do contrato nativo veio do usuário;
os testes locais usam essa evidência e dependências substituídas.

## 4. Validação executada e pendências

- PostgreSQL 17.4 local: **100 verificações aprovadas**, incluindo concorrência, casos
  reais de unidades, auditoria obrigatória e proteção de anexos.
- Frontend/gateway/cron: **111 testes aprovados**, mesmas sete falhas antigas de sidebar.
  Criação, sincronização, clonagem e mapper preservam as tuplas reais 10/1 e 20/2.
  Funções reais de normalização e atualização do cron foram executadas com dependências
  injetadas. Na continuação, `deno check` integral passou com Deno 2.9.6 e dependências
  reais. Corrigidos campo duplicado no novo mapper e `DataHoraDigitacao` ausente no tipo
  legado `PedidoLeve` (este último também falhava no HEAD original).
- TypeScript frontend, build e TypeScript gateway em cópia temporária aprovados;
  patch aplica em modo de conferência, sem alterar o repositório externo.
- **Storage integrado executado**: 26 verificações HTTP com file e 26 com S3 MinIO,
  Auth/PostgREST/Storage reais, baseline adaptado, três usuários não-admin e gateway
  com ERP HTTP simulado. Inclui DELETE bloqueado por transação de submissão, integridade
  dos bytes, multipart, reenvio e gravação efetiva da auditoria de envio. Reprodução e
  limites em `tests/integrated/README.md`. Docker instalado no WSL; nenhum passo manual
  de instalação pendente. Os 111 testes unitários passaram novamente, excluindo sidebar.

Nenhuma alteração em produção, push ou publicação. Implantação futura precisa incluir
SQL, frontend, gateway e Edge de sync de forma coordenada, seguida de aceite integrado.

## 5. Levantamento de unidades em produção — somente SELECT

Projeto `hbtggrbauguukewiknew`; janela de 90 dias até 07/09/2026 usando
`coalesce(data_abertura_alvo,created_at)`. Resultado: 286 requisições, 363 itens,
171 produtos; 11 requisições sem itens no espelho. A data de criação usada como fallback
pode ser a da importação, portanto o recorte não garante a data comercial original.

| Produto com escala em cache | Escala disponível | Itens no recorte |
|---|---|---:|
| 001.003.00001 | UNID posição 1/Peso 1; UN posição 2/Peso 1; Fator | 1 |
| 001.007.00018 | M posição 1/Peso 1; Fator | 1 |
| 001.007.00025 | UNID posição 1/Peso 1; KG posição 2/Peso 0.005; Fator | 1 |

Cobertura escalar: **3/171 produtos (1,75%) e 3/363 itens (0,83%)**. Nas escalas
presentes não há Divisor nem base não normalizada. **168 produtos sem escala não
foram classificados como suportados ou incompatíveis.** O cache foi sincronizado em
10/08/2026 e não armazena flags de dependência/dimensão/compras; mesmo os três produtos
exigem Produto/Load fresco para classificação completa pelo parser atual.

O produto 001.013.00382 aparece em dois itens/dois documentos no recorte, com unidade
espelhada PACOTE e sem escala no cache. Sua captura fornecida pelo usuário é evidência
separada: não sobrescreve esse histórico nem permite deduzir quantidades/posições.
Os campos novos de quantidade solicitada/posição ainda não existem em produção.

Para fechar as lacunas: Produto/Load completo e atual dos produtos listados com
`escala_disponivel=[]` em `tests/cobertura-unidades.json`, incluindo ProdUnidMedChildList
e flags; ReqComp/Load dos históricos incompletos para recuperar a tupla original.
Se aparecer Divisor/dimensional/base diferente, fornecer também Insert nativo conforme
§3. Nenhuma chamada Insert ou reconstrução de dado histórico foi feita neste levantamento.

## 6. Continuação: acesso real e middleware

Produto/Load pelo gateway respondeu 401 na primeira chamada; as demais 170 foram
poupadas da mesma recusa. 171 consultas inconclusivas, zero classificações de suporte
real; a ausência de cache não virou incompatibilidade. Coletor com cache e validador
canônico preparado. Requer acesso seguro fora do chat; ver `ACESSO-E-GATEWAY.md`.

Origin/main do gateway atualizado por fetch e confirmado em `76f67b2`; patch aplica.
20 testes do middleware real com Express/jose/CORS/body parser passaram. Não confundidos
com execução de banco/ERP real: são testes complementares aos 52 de Storage anteriores.
Health Render 200 sem SHA; versão implantada permanece não identificada por falta de
acesso autenticado. Roteiro concreto de aceite e recuperação em `ACEITE-ALVO.md`.

**Atualização posterior:** usuário confirmou no painel Render o Live `76f67b2`, main,
06/09/2026 às 17h28. Bloqueio de identificação do commit resolvido por essa evidência,
registrada separadamente; não foi acesso direto do agente. Launcher PowerShell com
entrada oculta preparado e sintaxe validada para retomar a coleta com JWT local.

## 7. Classificação final offline

171 respostas preservadas e reavaliadas pelo mesmo shared da implementação, idêntico
à cópia do gateway: 170 produtos totalmente suportados, 1 parcial, zero totalmente
bloqueados; 194 unidades suportadas e 2 bloqueadas. M3/2 e M3/3 de 001.017.092 são
Divisor/Peso 10; M3/3 está marcada para compras. Histórico desse produto usa UNID/1
no cadastro atual, suportada, sem reconstruir a posição histórica ausente.
Nenhum dos 171 pares de unidade usados nos 363 itens recentes foi bloqueado por formato.
Detalhes, 41 marcas de compras e pendências em `CLASSIFICACAO-UNIDADES.md`.
Executado `tests/classificar-cache.mjs`, exit 0, zero rede; cadastro/quantidades não alterados.

## 8. Aceite com participantes e correção visual

Caio/Engenharia e Ana/Marketing têm configuração para autor líder parcial; Mirlene
autora permite duas decisões de Caio/Ana. Zero CCs com dois vínculos ativos: caso de
alternativos exige atribuição adicional ou permanece local. Ana tem login explícito;
Caio/Guilherme não, portanto Ana fecha envio no primeiro caso. Somente SELECT executado.
Ver `ACEITE-PREENCHIDO.md` e evidência dos participantes, sem cadastros alterados.

Lacuna confirmada: aviso de M3 só aparecia no salvar. Corrigido localmente com aviso
inline no seletor, opção marcada indisponível e bloqueio dos botões/handlers. M3/3
preservada até escolha explícita. 113 testes passaram, sidebar excluído, TypeScript e
build passaram; sem navegador real nessa verificação. A primeira tentativa dos testes
DOM revelou dependência @testing-library/dom ausente; testes foram feitos com React DOM
já instalado, sem adicionar pacote ou alterar lockfile. Suíte final limpa nesse recorte.
# Implantação autorizada: ponto de espera Render

Ver [registro da janela](deployment/IMPLANTACAO.md). Baselines conferidos; zero
transições/envios sem confirmação. PAUSAR.sql aplicado e verificado. Gateway commit
4ef34d5 enviado; health ainda sem revisão nova. SQL principal/Edge/frontend aguardam.
112 verificações SQL (incluindo 12 da janela restrita), 20 Express real, 113 testes
frontend, type-checks, Deno integral e build passaram nesta janela. Storage 26+26
permanece evidência anterior. Conversões/CCs/lideranças preservados. Aceite real pendente.
# Continuação: SQL integral aplicado e verificado; Render 4ef34d5 confirmado pelo
# health; Edge v51 publicada com fonte/shared idênticos. Frontend em publicação.
# Nenhum aceite real executado; janela fechada, cron suspenso. Ver deployment/IMPLANTACAO.md.
## Revisão da correção de seletores — aceite-2

Ver CORRECAO-SELETORES.md: reprodução do componente anterior em consulta pendente,
120 testes de regressão aprovados e testes adicionais de reprodução/resposta sem lista,
menus em Chrome local nos dois temas (contraste mínimo 11,86:1), 10→1/20→2 preservados.
Sem alterações SQL/gateway/Edge, sem Inserts. Falta resposta autenticada de Produto/Load
para concluir o diagnóstico específico de 001.001.00051. Publicação Lovable requerida.


## Correção do timeout de unidades — continuação autorizada do aceite

Log Render: autenticação Alvo levou 48,59s em 07/09/2026 às 23:37 UTC,
excedendo os antigos 45s totais do formulário. Leitura Financial Hub agora tem
120s no gateway e 135s no frontend, aviso de espera e cancelamento sem GET tardio.
Sem alterar conversões, envios, SQL/Edge, cadastros ou novo IA Hub.
Diagnóstico, testes e publicação: docs/aprovacao-multicc/CORRECAO-TIMEOUT.md.
Operação restrita a quatro participantes; cron e sync de requisições suspensos.
