# Disparo de e-mails em lote

Aplicação estática em JavaScript que lê uma planilha no navegador, personaliza cada mensagem e envia uma solicitação por destinatário ao Google Apps Script. O remetente é a conta Google que concedeu o escopo `gmail.send`; o Apps Script não usa `GmailApp.sendEmail`.

## Arquivos

- `index.html`: formulário, autenticação e prévia da lista.
- `script.js`: leitura de XLSX/XLS/CSV, personalização, OAuth e fila sequencial.
- `styles.css`: layout responsivo e estados de progresso.
- `apps-script.gs`: endpoint do Web App, Gmail API e log por envio.

## Configuração do Google Cloud

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto (ou selecione um projeto dedicado).
2. Em **APIs e serviços > Biblioteca**, procure **Gmail API** e clique em **Ativar**.
3. Abra **Google Auth Platform > Branding** (ou **APIs e serviços > Tela de consentimento OAuth**, conforme a interface exibida). Informe o nome do app, e-mail de suporte e os dados de contato exigidos. Para uso por contas pessoais, escolha o público **Externo**.
4. Em **Audience/Público**, mantenha o app em **Testing/Teste** durante o desenvolvimento e cadastre como usuários de teste todas as contas que farão login. Em produção, configure a publicação e conclua a verificação OAuth solicitada pelo Google antes de liberar o acesso publicamente.
5. Em **Data Access/Acesso aos dados**, adicione os escopos:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email` (o escopo `email` do GIS solicita essa identidade)
   - `https://www.googleapis.com/auth/userinfo.profile` (o escopo `profile` do GIS)
   - `https://www.googleapis.com/auth/gmail.send`

   O escopo `gmail.send` é sensível. Siga os requisitos de verificação que o Google mostrar para a publicação pretendida; não basta ativar a API para remover as restrições de consentimento.
6. Em **Clients/Clientes > Create client/Criar cliente**, crie um OAuth Client ID do tipo **Web application/Aplicativo da Web**.
7. Em **Authorized JavaScript origins/Origens JavaScript autorizadas**, cadastre a origem exata do site, sem caminho. Exemplos: `http://localhost:5500` durante desenvolvimento ou `https://usuario.github.io` no GitHub Pages. Se o domínio publicado for próprio, use `https://seu-dominio`.
8. Não é necessário cadastrar redirect URI para o fluxo de token do GIS usado aqui. Copie o **Client ID** (não o Client Secret) para a constante `GOOGLE_CLIENT_ID` em `script.js` e `apps-script.gs`. O Client ID é público; o Client Secret não deve ser colocado no front-end.

## Configuração da planilha e do Apps Script

1. Use a planilha Google **DispararEmail**. O código abaixo já está configurado para o ID `1LEfGa_tTBEy29BQH8F6u01YK2pwzR0AlrMvbyGj59B4`.
2. Use um projeto Apps Script **independente**, separado dos projetos que atendem outros sites. No projeto novo, mantenha somente o código de `apps-script.gs`; ele abre a planilha pelo ID usando `SpreadsheetApp.openById`.
3. Substitua `COLE_SEU_CLIENT_ID_AQUI` no Apps Script pelo Client ID OAuth criado acima.
4. Em **Configurações do projeto > Projeto do Google Cloud**, vincule o projeto Apps Script ao mesmo projeto Google Cloud onde a Gmail API e o Client ID foram configurados. Confira o número do projeto antes de salvar a alteração.
5. Salve o projeto e execute `setupLog` no editor para criar/corrigir o cabeçalho e iniciar a autorização; aceite as permissões de acesso à planilha e de chamadas externas. Se necessário, revise **Configurações do projeto > Mostrar o arquivo de manifesto `appsscript.json`** e confirme que os escopos `https://www.googleapis.com/auth/spreadsheets` e `https://www.googleapis.com/auth/script.external_request` estão presentes.
6. No Apps Script, selecione **Implantar > Nova implantação > App da Web**:
   - **Executar como:** sua conta Google (proprietário da planilha).
   - **Quem tem acesso:** qualquer pessoa, para que o front-end estático consiga chamar o endpoint. O login/escopo do usuário é validado no código antes de chamar a Gmail API.
7. Implante e copie a URL terminada em `/exec`. O `script.js` já contém a URL da implantação informada para o projeto **Disparar-em-lote**. Se uma implantação nova gerar outra URL, atualize `GOOGLE_SCRIPT_URL` no `script.js`.
8. Publique o site por HTTPS, por exemplo no GitHub Pages, e inclua essa origem no OAuth Client ID. Para atualizar o backend, use **Implantar > Gerenciar implantações > Editar > Nova versão > Implantar**.
9. A primeira linha da aba `Log` será criada automaticamente com `Nome`, `E-mail`, `Data`, `Ator` e `Status`; cada processamento insere uma linha nova na posição 2.

## Planilha de contatos e envio

- A primeira aba do arquivo carregado é lida; a primeira linha precisa ter cabeçalhos, com uma coluna `E-mail` ou `Email`. A coluna `Nome` é opcional. Espaços, hífens, acentos e diferenças de caixa são ignorados ao localizar esses campos.
- São aceitos `.xlsx`, `.xls` e `.csv`. Só linhas com endereço de e-mail válido entram na fila.
- A planilha de contatos é lida localmente no navegador e não é enviada ao Apps Script; somente os dados de cada destinatário são enviados conforme a fila avança.
- Para personalizar, escreva `[nome do cabeçalho]` no assunto ou no corpo. Por exemplo, com cabeçalhos `Nome` e `Empresa`, use `Olá [nome], sobre a vaga na [empresa]`. `[saudacao]` vira “bom dia”, “boa tarde” ou “boa noite”.
- O PDF, se selecionado, é anexado a cada mensagem. A implementação limita o upload a 10 MB para manter as solicitações individuais dentro de um tamanho prático.
- O navegador processa um contato por vez e só avança após receber a resposta do Apps Script. Falhas individuais são registradas com status `Erro` e não interrompem as próximas linhas. Se o token expirar, o lote pausa e pode ser continuado após novo login. Se houver falha de rede, o resultado pode ser indeterminado; confira o Log antes de reenviar para evitar duplicidades.

## Limites e segurança

O envio consome as cotas e os limites diários da conta Gmail autenticada e está sujeito a limites de taxa da Gmail API. O modo de teste OAuth permite somente os usuários de teste cadastrados; a publicação para outros usuários pode exigir verificação do Google, especialmente por solicitar acesso ao Gmail. Nunca compartilhe ou registre o access token. O endpoint do Apps Script é público na implantação, mas exige um token Google válido com os escopos esperados e encaminha esse token à Gmail API sem armazená-lo.
