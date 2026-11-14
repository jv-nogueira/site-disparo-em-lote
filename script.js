// Configure os valores abaixo após publicar o Web App do Apps Script e criar o OAuth Client ID.
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyU6PYGTJYlP_yAQygw8LhOmqzYlQzqXksje9YMsd7E62rHiW_K8DjotyS2356QMPQ/exec';
const GOOGLE_CLIENT_ID = '1054091680574-o7op57beh1h7dh8na65borsdn36sh19r.apps.googleusercontent.com';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PREVIEW_LIMIT = 5;

const form = document.getElementById('mail-form');
const authStatus = document.getElementById('auth-status');
const signInButton = document.getElementById('google-signin-button');
const signOutButton = document.getElementById('google-signout-button');
const fileInput = document.getElementById('spreadsheet-file');
const fileName = document.getElementById('spreadsheet-name');
const contactsSummary = document.getElementById('contacts-summary');
const previewWrap = document.getElementById('contacts-preview-wrap');
const previewBody = document.getElementById('contacts-preview');
const subjectInput = document.getElementById('subject');
const messageInput = document.getElementById('message');
const attachmentInput = document.getElementById('attachment-file');
const submitButton = document.getElementById('submit-button');
const resetButton = document.getElementById('reset-button');
const statusBox = document.getElementById('status');
const progressBar = document.getElementById('send-progress');
const progressStatus = document.getElementById('progress-status');
const progressCount = document.getElementById('progress-count');
const progressDetail = document.getElementById('progress-detail');

let contacts = [];
let columnNames = [];
let accessToken = '';
let actorEmail = '';
let tokenClient = null;
let sending = false;
let nextContactIndex = 0;
let batchResults = { sent: 0, failed: 0, outcomeUnknown: 0 };

function setStatus(message, type = '') {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function setAuthenticated(email) {
  actorEmail = email;
  authStatus.textContent = `Conectado como ${email}. Os e-mails sairão desta conta.`;
  signInButton.hidden = true;
  signOutButton.hidden = false;
  updateSubmitState();
}

function updateSubmitState() {
  submitButton.disabled = sending || !accessToken || contacts.length === 0;
  submitButton.textContent = nextContactIndex > 0 && nextContactIndex < contacts.length
    ? 'Continuar envio'
    : 'Iniciar envio';
  fileInput.disabled = sending;
  subjectInput.disabled = sending;
  messageInput.disabled = sending;
  attachmentInput.disabled = sending;
  resetButton.disabled = sending;
  signOutButton.disabled = sending;
}

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isValidEmail(email) {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email);
}

function renderContactsPreview() {
  previewBody.replaceChildren();
  contacts.slice(0, PREVIEW_LIMIT).forEach((contact) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const emailCell = document.createElement('td');
    nameCell.textContent = contact.name || '—';
    emailCell.textContent = contact.email;
    row.append(nameCell, emailCell);
    previewBody.appendChild(row);
  });

  previewWrap.hidden = contacts.length === 0;
  contactsSummary.textContent = contacts.length
    ? `${contacts.length} contato(s) válido(s) carregado(s).`
    : 'Nenhum contato com e-mail válido foi encontrado.';
  updateSubmitState();
}

function loadSpreadsheet(file) {
  contacts = [];
  columnNames = [];
  nextContactIndex = 0;
  batchResults = { sent: 0, failed: 0, outcomeUnknown: 0 };
  fileName.textContent = file ? file.name : 'Nenhum arquivo selecionado';
  renderContactsPreview();

  if (!file) {
    renderContactsPreview();
    return;
  }
  if (!window.XLSX) {
    setStatus('A biblioteca de planilhas não carregou. Atualize a página e tente novamente.', 'error');
    renderContactsPreview();
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(event.target.result, { type: 'array', cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error('A planilha não contém abas.');

      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false,
      });
      if (!rows.length) throw new Error('A planilha está vazia.');

      columnNames = rows[0].map((header) => String(header ?? '').trim());
      const emailIndex = columnNames.findIndex((header) => normalizeHeader(header) === 'email');
      const nameIndex = columnNames.findIndex((header) => normalizeHeader(header) === 'nome');
      if (emailIndex < 0) throw new Error('Não encontrei uma coluna “E-mail” ou “Email” no cabeçalho da primeira linha.');

      contacts = rows.slice(1).map((row, rowOffset) => {
        const values = columnNames.map((_, index) => String(row[index] ?? '').trim());
        const email = values[emailIndex] || '';
        return {
          name: nameIndex < 0 ? '' : values[nameIndex],
          email,
          values,
          rowNumber: rowOffset + 2,
        };
      }).filter((contact) => isValidEmail(contact.email));

      setStatus('', '');
      renderContactsPreview();
    } catch (error) {
      contacts = [];
      renderContactsPreview();
      setStatus(error.message || 'Não foi possível ler a planilha.', 'error');
    }
  };
  reader.onerror = () => {
    contacts = [];
    renderContactsPreview();
    setStatus('Falha ao ler o arquivo selecionado.', 'error');
  };
  reader.readAsArrayBuffer(file);
}

function greetingForCurrentTime() {
  const hour = new Date().getHours();
  if (hour < 12) return 'bom dia';
  if (hour < 18) return 'boa tarde';
  return 'boa noite';
}

function renderTemplate(template, contact) {
  const valuesByHeader = new Map(
    columnNames.map((header, index) => [normalizeHeader(header), contact.values[index] ?? ''])
  );
  valuesByHeader.set('saudacao', greetingForCurrentTime());

  return String(template).replace(/\[([^\]]+)\]/g, (tag, header) => {
    const key = normalizeHeader(header);
    return valuesByHeader.has(key) ? valuesByHeader.get(key) : tag;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o PDF anexado.'));
    reader.readAsDataURL(file);
  });
}

async function postEmail(payload) {
  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`Resposta inválida do Apps Script (HTTP ${response.status}).`);
  }
  if (!response.ok || !result.ok) {
    if (result.authRequired) {
      signOut();
    }
    const error = new Error(result.error || `Falha no envio (HTTP ${response.status}).`);
    error.authRequired = result.authRequired === true;
    throw error;
  }
  return result;
}

function updateProgress(done, total, status, detail = '') {
  progressBar.max = Math.max(total, 1);
  progressBar.value = done;
  progressCount.textContent = `${done} / ${total}`;
  progressStatus.textContent = status;
  progressDetail.textContent = detail;
}

async function sendBatch(event) {
  event.preventDefault();
  if (sending || !accessToken || contacts.length === 0) return;
  if (nextContactIndex >= contacts.length) {
    nextContactIndex = 0;
    batchResults = { sent: 0, failed: 0, outcomeUnknown: 0 };
  }

  const subjectTemplate = subjectInput.value.trim();
  const messageTemplate = messageInput.value.trim();
  if (!subjectTemplate || !messageTemplate) {
    setStatus('Preencha o assunto e o corpo do e-mail.', 'error');
    return;
  }

  const attachment = attachmentInput.files[0] || null;
  if (attachment && attachment.type !== 'application/pdf' && !attachment.name.toLowerCase().endsWith('.pdf')) {
    setStatus('O anexo precisa ser um arquivo PDF.', 'error');
    return;
  }
  if (attachment && attachment.size > MAX_ATTACHMENT_BYTES) {
    setStatus('O PDF ultrapassa o limite recomendado de 10 MB.', 'error');
    return;
  }

  const remaining = contacts.length - nextContactIndex;
  const action = nextContactIndex ? 'continuar o envio de' : 'enviar';
  const confirmed = window.confirm(`Deseja ${action} ${remaining} e-mail(s) usando ${actorEmail}? Cada contato será processado individualmente.`);
  if (!confirmed) return;

  sending = true;
  updateSubmitState();
  setStatus('', '');
  updateProgress(nextContactIndex, contacts.length, 'Preparando envio', 'Cada resultado será gravado na aba Log.');

  let fileData = '';
  try {
    if (attachment) fileData = await fileToBase64(attachment);
  } catch (error) {
    sending = false;
    updateSubmitState();
    setStatus(error.message, 'error');
    return;
  }

  let stoppedForAuth = false;

  for (let index = nextContactIndex; index < contacts.length; index += 1) {
    const contact = contacts[index];
    const current = index + 1;
    updateProgress(index, contacts.length, `Enviando ${current} de ${contacts.length}`, contact.email);

    try {
      await postEmail({
        accessToken,
        recipientEmail: contact.email,
        recipientName: contact.name,
        subject: renderTemplate(subjectTemplate, contact),
        message: renderTemplate(messageTemplate, contact),
        fileName: attachment ? attachment.name : '',
        fileData,
        fileMimeType: attachment ? 'application/pdf' : '',
      });
      batchResults.sent += 1;
      nextContactIndex = index + 1;
      updateProgress(current, contacts.length, `Enviando ${current} de ${contacts.length}`, `Enviado: ${contact.email}`);
    } catch (error) {
      if (error.authRequired) {
        stoppedForAuth = true;
        updateProgress(index, contacts.length, 'Envio pausado: autorização necessária', error.message);
        break;
      }
      batchResults.failed += 1;
      if (/Resposta inválida|Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
        batchResults.outcomeUnknown += 1;
      }
      nextContactIndex = index + 1;
      updateProgress(current, contacts.length, `Enviando ${current} de ${contacts.length}`, `Erro em ${contact.email}: ${error.message}`);
      console.error(`Falha ao processar a linha ${contact.rowNumber} (${contact.email}):`, error);
    }
  }

  sending = false;
  updateSubmitState();
  const processed = nextContactIndex;
  const summary = stoppedForAuth
    ? `Envio pausado após ${processed} de ${contacts.length} contato(s). Entre novamente e use “Continuar envio” para retomar do contato pendente.`
    : `${batchResults.sent} enviado(s), ${batchResults.failed} com erro.${batchResults.outcomeUnknown ? ` Resultado de ${batchResults.outcomeUnknown} solicitação(ões) não confirmado; verifique o Log antes de tentar novamente.` : ''}`;
  updateProgress(
    processed,
    contacts.length,
    stoppedForAuth ? 'Envio pausado' : 'Lote concluído',
    summary
  );
  setStatus(
    stoppedForAuth
      ? `${summary} Consulte a aba Log antes de retomar.`
      : `${batchResults.sent} e-mail(s) enviado(s); ${batchResults.failed} com erro. Consulte a aba Log para os resultados por destinatário.`,
    batchResults.failed || stoppedForAuth ? 'error' : 'success'
  );
}

function initializeOAuth() {
  if (!window.google?.accounts?.oauth2) {
    authStatus.textContent = 'O login do Google não carregou. Atualize a página e tente novamente.';
    return;
  }
  if (GOOGLE_CLIENT_ID === 'COLE_SEU_CLIENT_ID_AQUI' || GOOGLE_SCRIPT_URL === 'COLE_A_URL_DO_WEB_APP_AQUI') {
    authStatus.textContent = 'Configure o Client ID e a URL do Apps Script em script.js.';
    signInButton.disabled = true;
    return;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
    callback: async (tokenResponse) => {
      if (tokenResponse.error || !tokenResponse.access_token) {
        authStatus.textContent = tokenResponse.error_description || 'Não foi possível autorizar o acesso ao Gmail.';
        return;
      }
      accessToken = tokenResponse.access_token;
      try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new Error('Não foi possível identificar a conta Google.');
        const user = await response.json();
        if (!user.email || user.verified_email === false) throw new Error('A conta Google não possui e-mail verificado.');
        setAuthenticated(user.email);
      } catch (error) {
        signOut();
        authStatus.textContent = error.message;
      }
    },
    error_callback: (error) => {
      authStatus.textContent = error.message || 'A janela de autenticação foi fechada ou bloqueada.';
    },
  });
}

function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = '';
  actorEmail = '';
  authStatus.textContent = 'Entre com a conta Google que enviará os e-mails.';
  signInButton.hidden = false;
  signOutButton.hidden = true;
  updateSubmitState();
}

fileInput.addEventListener('change', () => loadSpreadsheet(fileInput.files[0]));
form.addEventListener('submit', sendBatch);
signInButton.addEventListener('click', () => {
  if (!tokenClient) initializeOAuth();
  if (tokenClient) tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
});
signOutButton.addEventListener('click', signOut);
resetButton.addEventListener('click', () => {
  if (sending) return;
  form.reset();
  contacts = [];
  columnNames = [];
  nextContactIndex = 0;
  batchResults = { sent: 0, failed: 0, outcomeUnknown: 0 };
  fileName.textContent = 'Nenhum arquivo selecionado';
  renderContactsPreview();
  progressBar.value = 0;
  progressBar.max = 1;
  progressCount.textContent = '0 / 0';
  progressStatus.textContent = 'Pronto para começar';
  progressDetail.textContent = 'O resultado de cada destinatário será registrado na aba Log.';
  setStatus('', '');
});

window.addEventListener('load', initializeOAuth, { once: true });
