# Diagnóstico autenticado do formulário publicado

Release: `multicc-20260907-aceite-2`. Gateway: `4ef34d5`.
Sessão fornecida pelo usuário: Pedro Scrignoli (admin). Não comprova RBAC não-admin.
O navegador isolado acessou o formulário real, sem ler armazenamento de sessão,
tokens, cookies ou senhas. Nenhum item/requisição foi persistido ou enviado ao Alvo.

## Observações executadas

- `001.001.00051`: GET real HTTP 200 em 10,457 s (início até cabeçalhos).
  Resposta salva neste diretório; UNID/1/Peso 1/Fator/compras Não.
  Preenchimento automático e seletor habilitado, captura `drypatch.png`.
- `001.013.00382`: GET real HTTP 200 em 10,448 s. UNID/2 (compras)
  selecionada automaticamente. Quantidade 10 permitiu avançar ao rateio de classes;
  não foi acionado Adicionar nem qualquer persistência.
- Uma leitura de DRYPATCH foi deliberadamente retida no navegador para testar
  o prazo máximo. A tela exibiu timeout e Tentar novamente. Essa ocorrência é
  **simulada**, identificada em `rede.json` e `timeout-controlado.png`.
- Depois de encerrar a interceptação (`Fetch.disable`), o botão Tentar novamente
  iniciou outra leitura real. O preflight respondeu 204, mas o GET não trouxe
  resposta antes de 45 s e foi abortado. Essa ocorrência **não é o atraso simulado**;
  captura `timeout-real-apos-retry.png`. O health do Render continuou HTTP 200.
- A leitura de `src/components/ApiTester.tsx` confirmou que o Laboratório chama o
  Alvo diretamente. Seu JSON não prova a disponibilidade do caminho pelo Render.
- Regressão local de consulta e aviso: 12 testes passaram (7 + 5).

## Limite atual

O sucesso inicial não encerra o defeito: houve timeout intermitente real.
Falta localizar a espera dentro do gateway/ERP nos logs do Render. O painel foi
aberto na janela isolada e exige login do usuário. Não atribuir a falha a conversão,
CORS, autenticação ou cold start sem a evidência correspondente.

Os eventos de rede registram apenas método, caminho, status e tempo; não contêm
headers nem credenciais. Os dois Loads são evidências desta validação, sem repetir
a coleta dos 171 produtos e sem alterar cadastros ou reconstruir histórico.

Diagnóstico posteriormente encerrado: log Render confirmou 48,59s de autenticação,
acima do prazo antigo. Aceite-3 foi publicado e validado com leitura real em 54,794s.
Ver ../../CORRECAO-TIMEOUT.md e ../formulario-aceite-3/resultado.json.
