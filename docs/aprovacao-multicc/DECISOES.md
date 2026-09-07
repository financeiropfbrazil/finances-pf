# Aprovação por todos os CCs — 07/09/2026

Preparação local solicitada pelo Pedro. Não aplicar migrations, push ou publicar.

## Investigação e decisões antes da implementação

Fingerprint de produção `hbtggrbauguukewiknew`: 3 tabelas do módulo, 2.038 pedidos.
Git `main` em `8f1e315`, atualizado por pull fast-forward, sem commits recebidos.
Não há AGENTS.md dentro do repositório. Arquivos não rastreados preexistentes preservados.
Definições de produção salvas em `funcoes-producao-antes.sql` (SELECT apenas).

Fluxo atual: wizard edita itens em memória e cria rascunho/filhos/anexos; submissão
roteia pelo cabeçalho; fila e detalhe também filtram pelo cabeçalho; ambos enviam
imediatamente depois de qualquer aprovação. Reenvio de rascunho ressubmete, mas
`pendente_envio` tem uma segunda implementação que chama o Alvo diretamente.
Não há editor persistente de requisição; clonar cria outra requisição. Itens/filhos
têm escrita aberta por RLS, portanto esconder edição não protege a submissão.
O cron só deve espelhar documentos com número Alvo; a nova trava não bloqueia esse espelho.

O payload atual perde o CC próprio do item e envia `ReqCompClasseRecDespChildList=[]`.
As tabelas de rateio de CC existem, mas o wizard ainda só captura classe contábil.

## Regra única de CC

União DISTINCT dos códigos não vazios (trim) do cabeçalho, de todos os itens e dos
CCs de `compras_requisicoes_rateio_cc` ligados pelas classes à requisição.
Cabeçalho e CC repetido em vários itens/classes contam uma única vez. Classe contábil
de item não introduz CC. Percentuais positivos, inclusive 1%, não têm limiar.
Com rateio, o cabeçalho deve pertencer ao rateio (regra R3.2 documentada).
Sem CC no item, herda o cabeçalho. Submissão valida itens e rateio antes de congelar.

## Regras preservadas e conflitos resolvidos

- R5 antiga (proíbe autoaprovação multi-CC) substituída pela orientação desta sessão:
  dispensa do autor somente nos CCs que ele lidera, mesmo numa requisição multi-CC.
- Preservados `lider_departamento` e `compras_lideres_cc`, sem papel de suplente.
  Qualquer líder do mesmo CC satisfaz o grupo. Uma ação cobre todos os seus CCs.
- Rejeição por qualquer líder envolvido é terminal, inclusive se ele já aprovou
  seus CCs e o documento ainda aguarda outros. Catálogo e observação preservados.
- Sem líder: dispensa auditada, reavaliada dinamicamente enquanto pendente; novo
  líder passa a ser exigido. Uma aprovação válida já registrada é evidência
  histórica por CC; revogar o vínculo depois não apaga a decisão.
- Admin aprova explicitamente tudo. Ser admin não dispensa CC alheio na submissão.
- O fechamento congela o resultado; alteração do mapa depois do fechamento não
  reabre uma aprovação. Rejeição e aprovação final são serializadas pelo pai.

## Proteção de envio e limite entre repositórios

O adendo antigo dizia que o gateway não precisava mudar. Isso conflita com a
exigência atual de impedir envio antecipado no backend: as duas rotas recebem
payload livre e apenas verificam JWT. Registrar sucesso depois do HTTP não protege
o Alvo. A entrega precisa de SQL + frontend + patch do gateway, conjuntamente.
O plano de revisão §1.9 reserva o erp-proxy ao Pedro: preparar patch neste repo,
sem editar/deployar o repo externo. A cópia local dele não comprova a versão no Render;
o patch deve ser conferido contra a versão corrente antes da futura aplicação.

Gateway deve reivindicar envio atomicamente, montar o payload a partir do banco e
registrar resultado com token de tentativa. Cliente não pode confirmar sucesso.
Timeout/erro ambíguo mantém tentativa bloqueada para reconciliação: nunca liberar
reenvio automático de algo que pode já existir no ERP. Falha comprovada sem criação
permite nova tentativa, preservando as aprovações.

## Transição e rollback

Medição inicial: sem número Alvo, 24 rascunhos e 4 rejeitadas; nenhuma pendente ou
aprovada. A migration deve recusar aplicação caso apareçam pendentes/aprovadas/envios
em andamento, exigindo revisão de transição antes do rollout, sem conceder aprovação
multi-CC retroativa por uma decisão antiga de cabeçalho.
Rollback antes de aplicar: descartar somente arquivos desta entrega. Depois de
aplicar e usar: não apagar evidências de aprovação; suspender criação no gateway e
revisar pendências antes de restaurar funções antigas. Não usar `supabase db push`.

Conferência adicional de produção (SELECT): 15 vínculos ativos, 4 líderes; zero vínculos sem papel lider_departamento e zero sem permissão compras.requisicoes.aprovar. Não há incompatibilidade atual com a exigência conjunta de papel e mapa.


Revisão posterior: ver REVISAO.md. A evidência SQL original não incluía a constraint
de auditoria; os novos testes a reproduzem. Storage e unidades tiveram os limites
corrigidos. Unidades alternativas e aceite HTTP/S3/Alvo seguem pendentes.


Continuação com load-gpt6-1.txt: o bloqueio geral de unidades alternativas foi substituído
pelo suporte Fator por cadastro (base normalizada), mantendo bloqueados formatos ainda
não comprovados. Preserve a tupla histórica pelo ReqComp/Load; jamais inferir Quantidade2.
SQL + frontend + gateway + cron agora compõem a entrega. Ver REVISAO.md atualizado.
