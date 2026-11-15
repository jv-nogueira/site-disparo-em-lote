# Disparo de e-mails em lote

Aplicação estática em JavaScript que lê uma planilha no navegador, personaliza cada mensagem e envia uma solicitação por destinatário ao Google Apps Script. O remetente é a conta Google que concedeu o escopo `gmail.send`; o Apps Script não usa `GmailApp.sendEmail`.

## Arquivos

- `index.html`: formulário, autenticação e prévia da lista.
- `script.js`: leitura de XLSX/XLS/CSV, personalização, OAuth e fila sequencial.
- `styles.css`: layout responsivo e estados de progresso.
- `apps-script.gs`: endpoint do Web App, Gmail API e log por envio.
- `privacidade.html`: política pública para usuários e cadastro OAuth.

## Configuração do Google Cloud

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto (ou selecione um projeto dedicado).
2. Em **APIs e serviços > Biblioteca**, procure **Gmail API** e clique em **Ativar**.
3. Abra **Google Auth Platform > Branding** (ou **APIs e serviços > Tela de consentimento OAuth**, conforme a interface exibida). Informe o nome do app, e-mail de suporte e os dados de contato exigidos. Para uso por contas pessoais, escolha o público **Externo**.
4. Em **Audience/Público**, mantenha o app em **Testing/Teste** durante o desenvolvimento e cadastre como usuários de teste todas as contas que farão login. O modo de teste não é adequado para um SaaS público: para produção, configure a publicação e conclua as verificações OAuth necessárias para o escopo do Gmail.
5. Em **Data Access/Acesso aos dados**, adicione os escopos:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email` (o escopo `email` do GIS solicita essa identidade)
   - `https://www.googleapis.com/auth/userinfo.profile` (o escopo `profile` do GIS)
   - `https://www.googleapis.com/auth/gmail.send`

   O escopo `gmail.send` é classificado como sensível. Para publicar para usuários externos, prepare a verificação OAuth e a verificação de marca solicitadas pelo Google. A análise pode levar vários dias; consulte as [instruções oficiais de verificação](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
6. Em **Clients/Clientes > Create client/Criar cliente**, crie um OAuth Client ID do tipo **Web application/Aplicativo da Web**.
7. Em **Authorized JavaScript origins/Origens JavaScript autorizadas**, cadastre a origem exata do site, sem caminho. Exemplos: `http://localhost:5500` durante desenvolvimento ou `https://usuario.github.io` no GitHub Pages. Se o domínio publicado for próprio, use `https://seu-dominio`.
8. Não é necessário cadastrar redirect URI para o fluxo de token do GIS usado aqui. Copie o **Client ID** (não o Client Secret) para a constante `GOOGLE_CLIENT_ID` em `script.js` e `apps-script.gs`. O Client ID é público; o Client Secret não deve ser colocado no front-end.

## Configuração da planilha e do Apps Script

1. Use a planilha Google **DispararEmail**. O código abaixo já está configurado para o ID `1LEfGa_tTBEy29BQH8F6u01YK2pwzR0AlrMvbyGj59B4`.
2. Use um projeto Apps Script **independente**, separado dos projetos que atendem outros sites. No projeto novo, mantenha somente o código de `apps-script.gs`; ele abre a planilha pelo ID usando `SpreadsheetApp.openById`.
3. Substitua `COLE_SEU_CLIENT_ID_AQUI` no Apps Script pelo Client ID OAuth criado acima.
4. Em **Configurações do projeto > Projeto do Google Cloud**, vincule o projeto Apps Script ao mesmo projeto Google Cloud onde a Gmail API e o Client ID foram configurados. Confira o número do projeto antes de salvar a alteração.
5. Salve o projeto e execute `setupLog` no editor para criar/corrigir o cabeçalho na aba `Log-SaaS` e iniciar a autorização; aceite as permissões de acesso à planilha e de chamadas externas. Se necessário, revise **Configurações do projeto > Mostrar o arquivo de manifesto `appsscript.json`** e confirme que os escopos `https://www.googleapis.com/auth/spreadsheets` e `https://www.googleapis.com/auth/script.external_request` estão presentes.
6. No Apps Script, selecione **Implantar > Nova implantação > App da Web**:
   - **Executar como:** sua conta Google (proprietário da planilha).
   - **Quem tem acesso:** qualquer pessoa, para que o front-end estático consiga chamar o endpoint. O login/escopo do usuário é validado no código antes de chamar a Gmail API.
7. Implante e copie a URL terminada em `/exec`. Confira se `GOOGLE_SCRIPT_URL` no `script.js` contém exatamente essa URL e publique o front-end atualizado no GitHub Pages. Alterar o arquivo local não atualiza o site publicado; após publicar, confira a URL carregada pelo site antes de testar os envios.
8. Publique o site por HTTPS e cadastre `https://jv-nogueira.github.io` em **Origens JavaScript autorizadas**. Em **Branding**, informe a página inicial e a URL pública da política: `https://jv-nogueira.github.io/site-disparo-em-lote/` e `https://jv-nogueira.github.io/site-disparo-em-lote/privacidade.html`. O Google exige a verificação de propriedade dos domínios associados; como `github.io` é hospedagem compartilhada, confirme se o Console aceita a verificação desse endereço. Se não aceitar, use um domínio próprio que você controle, aponte-o ao GitHub Pages e atualize a origem OAuth e os links da tela de consentimento. Para atualizar o backend, use **Implantar > Gerenciar implantações > Editar > Nova versão > Implantar**.
9. A primeira linha da aba `Log-SaaS` será criada automaticamente com `Nome`, `E-mail`, `Data`, `Ator` e `Status`; cada processamento insere uma linha nova na posição 2. A aba `Log` antiga não é alterada e mantém os registros anteriores.

## Planilha de contatos e envio

- A primeira aba do arquivo carregado é lida; a primeira linha precisa ter cabeçalhos, com uma coluna `E-mail` ou `Email`. A coluna `Nome` é opcional. Espaços, hífens, acentos e diferenças de caixa são ignorados ao localizar esses campos.
- São aceitos `.xlsx`, `.xls` e `.csv`. Só linhas com endereço de e-mail válido entram na fila.
- A planilha de contatos é lida localmente no navegador e não é enviada ao Apps Script; somente os dados de cada destinatário são enviados conforme a fila avança.
- Para personalizar, escreva o nome exato do cabeçalho, após remover espaços no começo e fim, entre colchetes. A comparação diferencia maiúsculas, acentos e pontuação: cabeçalho `E-mail` exige `[E-mail]`; `[Email]` não corresponde. `[saudacao]` é uma tag especial e inclui a exclamação.
- O botão **Ver tags da primeira linha** mostra as tags e os valores do primeiro contato válido; **Pré-visualizar e-mail** apresenta o assunto e o corpo já substituídos para esse contato.
- Cc e Cco são opcionais e ficam recolhidos até o usuário selecionar **Adicionar Cc ou Cco**. Os endereços informados aplicam-se a cada e-mail do lote.
- O PDF, se selecionado, é anexado a cada mensagem. O nome do arquivo aparece junto a um botão `X` para removê-lo antes do envio. A implementação limita o upload a 10 MB para manter as solicitações individuais dentro de um tamanho prático.
- A barra de progresso aparece ao iniciar o lote. O navegador processa um contato por vez e só avança após receber a resposta do Apps Script. Falhas individuais são registradas com status `Erro` em `Log-SaaS` e não interrompem as próximas linhas; erros de cota pausam o lote e geram uma notificação. Se o token expirar, o lote pausa e pode ser continuado após novo login. Se houver falha de rede, o resultado pode ser indeterminado; confira `Log-SaaS` e a pasta Enviados antes de reenviar para evitar duplicidades.

## Limites e segurança

Há dois tipos de limites diferentes:

- **Limite de envio do Gmail da pessoa:** aplica-se à conta remetente e varia conforme o tipo e o estado da conta. A Gmail API não oferece uma chamada para consultar quantas mensagens restam no limite diário da conta. O sistema só consegue reagir quando o envio retorna um erro reconhecível. O [suporte do Gmail](https://support.google.com/mail/answer/22839?hl=pt-BR) informa que, após o erro de limite, o envio pode voltar em 1–24 horas; portanto, a interface não promete uma cota exata restante.
- **Cotas da Gmail API no Google Cloud:** são limites técnicos do projeto (por minuto por projeto/usuário e, dependendo das regras aplicáveis ao projeto, cotas de consumo da API). Eles não são o mesmo que o limite diário de envio da conta Gmail. Consulte **APIs e serviços > Gmail API > Cotas** e a [documentação oficial de quotas](https://developers.google.com/workspace/gmail/api/reference/quota).

Não existe uma chamada da Gmail API que informe a quantidade restante do limite diário de envio da conta. O toast é mostrado após cada lote e pausa o envio quando a API retorna um erro reconhecido como limite diário da conta ou cota técnica do projeto. Erros temporários de taxa também pausam o lote, sem afirmar que a cota diária acabou.

O access token não deve ser compartilhado nem salvo. O endpoint do Apps Script é público na implantação, mas valida o token antes de enviar e não o armazena. A política pública está em `privacidade.html`; revise os dados de contato, hospedagem, retenção e práticas reais antes de enviar a URL ao processo de verificação OAuth. Esta página é uma base informativa, não substitui aconselhamento jurídico.

## Planejamento para transformar em SaaS

1. **Backend multiusuário:** substituir o endpoint Apps Script público por backend autenticado com contas, sessões, isolamento entre clientes, rate limiting, auditoria, gestão de segredos e proteção contra abuso. Não confiar apenas em validações do navegador.
2. **OAuth por usuário em produção:** planejar o fluxo OAuth de servidor, revisão e verificação do escopo Gmail, renovação/revogação de tokens, armazenamento criptografado de refresh tokens e processo de exclusão de dados.
3. **Assinaturas e pagamentos:** escolher um provedor disponível no Brasil (por exemplo, Mercado Pago ou Stripe), definir cobrança recorrente semanal, webhooks assinados, estados de pagamento, tentativas recusadas, cancelamento, reembolso, nota fiscal e conciliação. R$ 9,90 por semana equivale a aproximadamente **R$ 42,90 por mês em média anual** (9,90 × 52 ÷ 12), antes das taxas do provedor, impostos e custos operacionais.
4. **Planos e limites:** estabelecer quantidade de envios, tamanho de anexo, usuários, política de reenvio e comportamento quando o limite do plano ou o Gmail do cliente é atingido. O pagamento não aumenta as cotas do Google.
5. **Privacidade e conformidade:** revisar LGPD, base legal e consentimento para listas, retenção e exclusão, termos de uso, suporte, política de abuso/spam e obrigações de cobrança.
6. **Operação e custos:** monitorar uso/cotas, erros, entregabilidade, suporte, backups e custos de hospedagem, banco, e-mail transacional, observabilidade e pagamentos antes de fixar o preço.
