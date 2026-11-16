// Configure os valores abaixo após publicar o Web App do Apps Script e criar o OAuth Client ID.
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzBVqnpU0s5sWc2lcWdDDBMQ3ch75JKDJl7xxyX94BxRnfh-SORONdM4e0HC6WhySM/exec';
const GOOGLE_CLIENT_ID = '1054091680574-o7op57beh1h7dh8na65borsdn36sh19r.apps.googleusercontent.com';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PREVIEW_LIMIT = 5;
const DEFAULT_SUBJECT = 'Candidatura - João Vitor Nogueira';
const DEFAULT_MESSAGE = `Olá [Nome], [saudacao]

Tudo bem?

Meu nome é João Vitor Nogueira e trabalho focado em automação de TI.

Tenho experiência em criar crawlers, scrapers e automações (RPA) que reduzem o trabalho manual.

Você pode consultar mais detalhes sobre meus projetos e experiências nos links abaixo:
LinkedIn: https://www.linkedin.com/in/nogueira-jv/
GitHub: https://github.com/jv-nogueira

Fico à disposição para esclarecimentos adicionais ou para uma eventual entrevista.

Agradeço desde já pela atenção e pelo tempo dedicado!

Atenciosamente,
João Vitor Nogueira
(11) 9 7776-8397`;

const form = document.getElementById('mail-form');
const authStatus = document.getElementById('auth-status');
const signInButton = document.getElementById('google-signin-button');
const signOutButton = document.getElementById('google-signout-button');
const fileInput = document.getElementById('spreadsheet-file');
const fileName = document.getElementById('spreadsheet-name');
const contactsSummary = document.getElementById('contacts-summary');
const spreadsheetPreviewButton = document.getElementById('spreadsheet-preview-button');
const spreadsheetPreviewModal = document.getElementById('spreadsheet-preview-modal');
const spreadsheetPreviewHead = document.getElementById('spreadsheet-preview-head');
const spreadsheetPreviewBody = document.getElementById('spreadsheet-preview-body');
const spreadsheetPreviewClose = document.getElementById('spreadsheet-preview-close');
const subjectInput = document.getElementById('subject');
const messageInput = document.getElementById('message');
const variableChips = document.getElementById('variable-chips');
const attachmentInput = document.getElementById('attachment-file');
const attachmentSelected = document.getElementById('attachment-selected');
const attachmentName = document.getElementById('attachment-name');
const attachmentSize = document.getElementById('attachment-size');
const removeAttachmentButton = document.getElementById('remove-attachment');
const ccInput = document.getElementById('cc');
const bccInput = document.getElementById('bcc');
const submitButton = document.getElementById('submit-button');
const resetButton = document.getElementById('reset-button');
const statusBox = document.getElementById('status');
const progressPanel = document.getElementById('progress-panel');
const progressBar = document.getElementById('send-progress');
const progressStatus = document.getElementById('progress-status');
const progressCount = document.getElementById('progress-count');
const progressDetail = document.getElementById('progress-detail');
const tagsToggle = document.getElementById('tags-toggle');
const tagsPanel = document.getElementById('tags-panel');
const tagsList = document.getElementById('tags-list');
const copiesToggle = document.getElementById('copies-toggle');
const copiesPanel = document.getElementById('copies-panel');
const previewButton = document.getElementById('preview-email-button');
const previewModal = document.getElementById('preview-modal');
const previewClose = document.getElementById('preview-close');
const previewBack = document.getElementById('preview-back');
const previewSend = document.getElementById('preview-send');
const toast = document.getElementById('toast');
let toastTimer = null;

let contacts = [];
let columnNames = [];
let accessToken = '';
let actorEmail = '';
let tokenClient = null;
let sending = false;
let nextContactIndex = 0;
let batchResults = { sent: 0, failed: 0, outcomeUnknown: 0, dailyQuota: false, apiDailyQuota: false, rateLimit: false };

function setStatus(message, type = '') {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function showToast(message, type = 'success', duration = 8000) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function setAuthenticated(email) {
  actorEmail = email;
  authStatus.textContent = `Conectado como ${email}. Os e-mails sairão desta conta.`;
  signInButton.hidden = true;
  signOutButton.hidden = false;
  updateSubmitState();
}

function updateSubmitState() {
  const batchComplete = contacts.length > 0 && nextContactIndex >= contacts.length;
  submitButton.disabled = sending || !accessToken || contacts.length === 0 || batchComplete;
  submitButton.textContent = batchComplete
    ? 'Lote concluído'
    : nextContactIndex > 0
      ? 'Continuar envio'
      : 'Iniciar envio';
  fileInput.disabled = sending;
  subjectInput.disabled = sending;
  messageInput.disabled = sending;
  attachmentInput.disabled = sending;
  removeAttachmentButton.disabled = sending;
  ccInput.disabled = sending;
  bccInput.disabled = sending;
  resetButton.disabled = sending;
  signOutButton.disabled = sending;
  tagsToggle.disabled = sending || contacts.length === 0;
  previewButton.disabled = sending || contacts.length === 0;
  spreadsheetPreviewButton.disabled = sending || contacts.length === 0;
  previewSend.disabled = sending || !accessToken;
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
  contactsSummary.textContent = contacts.length
    ? `${contacts.length} contato(s) válido(s) carregado(s).`
    : 'Nenhum contato com e-mail válido foi encontrado.';
  updateVariableChips();
  updateTagsPanel();
  updateSubmitState();
}

function updateVariableChips() {
  variableChips.replaceChildren();
  const headers = contacts.length ? columnNames : [];
  const tags = ['saudacao', ...headers.filter((header) => header)];
  [...new Set(tags)].forEach((header) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'variable-chip';
    chip.textContent = `[${header}]`;
    chip.addEventListener('click', () => {
      const start = messageInput.selectionStart;
      const end = messageInput.selectionEnd;
      messageInput.setRangeText(`[${header}]`, start, end, 'end');
      messageInput.focus();
    });
    variableChips.appendChild(chip);
  });
}

function renderSpreadsheetPreview() {
  spreadsheetPreviewHead.replaceChildren();
  spreadsheetPreviewBody.replaceChildren();

  const headerRow = document.createElement('tr');
  columnNames.forEach((column) => {
    const cell = document.createElement('th');
    cell.textContent = column;
    headerRow.appendChild(cell);
  });
  spreadsheetPreviewHead.appendChild(headerRow);

  contacts.slice(0, PREVIEW_LIMIT).forEach((contact) => {
    const row = document.createElement('tr');
    contact.values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value || '—';
      row.appendChild(cell);
    });
    spreadsheetPreviewBody.appendChild(row);
  });
}

function openSpreadsheetPreview() {
  if (!contacts.length) return;
  renderSpreadsheetPreview();
  spreadsheetPreviewModal.classList.add('active');
  spreadsheetPreviewModal.setAttribute('aria-hidden', 'false');
  spreadsheetPreviewClose.focus();
}

function closeSpreadsheetPreview() {
  spreadsheetPreviewModal.classList.remove('active');
  spreadsheetPreviewModal.setAttribute('aria-hidden', 'true');
}

function loadSpreadsheet(file) {
  contacts = [];
  columnNames = [];
  nextContactIndex = 0;
  batchResults = { sent: 0, failed: 0, outcomeUnknown: 0, dailyQuota: false, apiDailyQuota: false, rateLimit: false };
  progressPanel.hidden = true;
  progressBar.value = 0;
  progressBar.max = 1;
  progressCount.textContent = '0 / 0';
  progressStatus.textContent = 'Pronto para começar';
  progressDetail.textContent = 'O resultado de cada destinatário será registrado na aba Log-SaaS.';
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
      if (nameIndex >= 0 && messageInput.value === DEFAULT_MESSAGE) {
        messageInput.value = DEFAULT_MESSAGE.replaceAll('[Nome]', `[${columnNames[nameIndex]}]`);
      }

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
    columnNames.map((header, index) => [String(header).trim(), contact.values[index] ?? ''])
  );

  return String(template).replace(/\[([^\]]+)\]/g, (tag, header) => {
    const key = header.trim();
    if (key === 'saudacao') return `${greetingForCurrentTime()}!`;
    return valuesByHeader.has(key) ? valuesByHeader.get(key) : tag;
  });
}

function updateTagsPanel() {
  tagsList.replaceChildren();
  const firstContact = contacts[0];
  if (!firstContact) return;

  const greeting = `${greetingForCurrentTime()}!`;
  const hasGreetingColumn = columnNames.some((header) => String(header).trim() === 'saudacao');
  columnNames.forEach((header, index) => {
    const item = document.createElement('li');
    const tag = document.createElement('code');
    const name = String(header).trim();
    tag.textContent = `[${name}]`;
    const value = document.createElement('span');
    value.textContent = ` = ${name === 'saudacao' ? greeting : (firstContact.values[index] || '(vazio)')}`;
    item.append(tag, value);
    tagsList.appendChild(item);
  });

  if (!hasGreetingColumn) {
    const greetingItem = document.createElement('li');
    const greetingTag = document.createElement('code');
    greetingTag.textContent = '[saudacao]';
    const greetingValue = document.createElement('span');
    greetingValue.textContent = ` = ${greeting}`;
    greetingItem.append(greetingTag, greetingValue);
    tagsList.appendChild(greetingItem);
  }
}

function parseEmailList(value, label) {
  const emails = String(value || '')
    .split(/[,;]/)
    .map((email) => email.trim())
    .filter(Boolean);
  const invalid = emails.find((email) => !isValidEmail(email));
  if (invalid) {
    throw new Error(`Endereço inválido no campo ${label}: ${invalid}`);
  }
  return emails.join(',');
}

function openPreview() {
  const contact = contacts[0];
  if (!contact) {
    setStatus('Carregue uma planilha com ao menos um e-mail válido para pré-visualizar.', 'error');
    return;
  }

  document.getElementById('preview-to').textContent = contact.email;
  const cc = ccInput.value.trim();
  const bcc = bccInput.value.trim();
  document.getElementById('preview-cc').textContent = cc;
  document.getElementById('preview-cc-row').hidden = !cc;
  document.getElementById('preview-bcc').textContent = bcc;
  document.getElementById('preview-bcc-row').hidden = !bcc;
  document.getElementById('preview-subject').textContent = renderTemplate(subjectInput.value, contact) || '(Sem assunto)';
  document.getElementById('preview-attachment').textContent = attachmentInput.files[0]?.name || 'Sem anexo';
  document.getElementById('preview-body').textContent = renderTemplate(messageInput.value, contact) || '(Mensagem vazia)';
  previewModal.classList.add('active');
  previewModal.setAttribute('aria-hidden', 'false');
}

function closePreview() {
  previewModal.classList.remove('active');
  previewModal.setAttribute('aria-hidden', 'true');
}

function updateAttachmentSelection() {
  const selectedFile = attachmentInput.files[0] || null;
  attachmentName.textContent = selectedFile ? selectedFile.name : '';
  attachmentSize.textContent = selectedFile ? formatFileSize(selectedFile.size) : '';
  attachmentSelected.hidden = !selectedFile;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function removeAttachment() {
  if (sending) return;
  attachmentInput.value = '';
  updateAttachmentSelection();
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
    error.quotaType = result.quotaType || '';
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

  const subjectTemplate = subjectInput.value.trim();
  const messageTemplate = messageInput.value.trim();
  if (!subjectTemplate || !messageTemplate) {
    setStatus('Preencha o assunto e o corpo do e-mail.', 'error');
    return;
  }

  let cc;
  let bcc;
  try {
    cc = parseEmailList(ccInput.value, 'Cc');
    bcc = parseEmailList(bccInput.value, 'Cco');
  } catch (error) {
    setStatus(error.message, 'error');
    showToast(error.message, 'error');
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
  progressPanel.hidden = false;
  setStatus('', '');
  updateProgress(nextContactIndex, contacts.length, 'Preparando envio', 'Cada resultado será gravado na aba Log-SaaS.');

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
  let stoppedForQuota = false;

  for (let index = nextContactIndex; index < contacts.length; index += 1) {
    const contact = contacts[index];
    const current = index + 1;
    updateProgress(index, contacts.length, `Enviando ${current} de ${contacts.length}`, contact.email);

    try {
      await postEmail({
        accessToken,
        recipientEmail: contact.email,
        recipientName: contact.name,
        cc,
        bcc,
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
      nextContactIndex = index + 1;
      if (error.quotaType === 'gmail-daily') {
        batchResults.dailyQuota = true;
        stoppedForQuota = true;
      } else if (error.quotaType === 'api-daily') {
        batchResults.apiDailyQuota = true;
        stoppedForQuota = true;
      } else if (error.quotaType === 'api-rate') {
        batchResults.rateLimit = true;
        stoppedForQuota = true;
      }
      if (/Resposta inválida|Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
        batchResults.outcomeUnknown += 1;
      }
      updateProgress(current, contacts.length, `Enviando ${current} de ${contacts.length}`, `Erro em ${contact.email}: ${error.message}`);
      console.error(`Falha ao processar a linha ${contact.rowNumber} (${contact.email}):`, error);
      if (stoppedForQuota) break;
    }
  }

  sending = false;
  updateSubmitState();
  const processed = nextContactIndex;
  const summary = stoppedForQuota && batchResults.dailyQuota
    ? `O Gmail informou que a conta atingiu o limite diário de envio. O lote foi pausado após ${processed} de ${contacts.length}; tente novamente amanhã (a liberação pode levar até 24 horas).`
    : stoppedForQuota && batchResults.apiDailyQuota
      ? `A cota diária da Gmail API deste projeto Cloud foi atingida. Isso é diferente do limite diário de envio da sua conta Gmail; confira as cotas do projeto e retome quando o Google liberar o uso.`
      : stoppedForQuota
      ? `A Gmail API atingiu um limite de uso do projeto. O lote foi pausado após ${processed} de ${contacts.length}; aguarde e tente continuar mais tarde.`
      : stoppedForAuth
    ? `Envio pausado após ${processed} de ${contacts.length} contato(s). Entre novamente e use “Continuar envio” para retomar do contato pendente.`
    : `${batchResults.sent} enviado(s), ${batchResults.failed} com erro.${batchResults.outcomeUnknown ? ` Resultado de ${batchResults.outcomeUnknown} solicitação(ões) não confirmado; verifique o Log-SaaS antes de tentar novamente.` : ''}`;
  updateProgress(
    processed,
    contacts.length,
    stoppedForAuth || stoppedForQuota ? 'Envio pausado' : 'Lote concluído',
    summary
  );
  setStatus(
    stoppedForAuth || stoppedForQuota
      ? `${summary} Consulte a aba Log-SaaS antes de retomar.`
      : `${batchResults.sent} e-mail(s) enviado(s); ${batchResults.failed} com erro. Consulte a aba Log-SaaS para os resultados por destinatário.`,
    batchResults.failed || stoppedForAuth || stoppedForQuota ? 'error' : 'success'
  );
  showToast(
    summary,
    stoppedForAuth || stoppedForQuota || batchResults.failed ? 'warning' : 'success',
    12000
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
attachmentInput.addEventListener('change', updateAttachmentSelection);
removeAttachmentButton.addEventListener('click', removeAttachment);
form.addEventListener('submit', sendBatch);
tagsToggle.addEventListener('click', () => {
  const isExpanded = tagsToggle.getAttribute('aria-expanded') === 'true';
  tagsToggle.setAttribute('aria-expanded', String(!isExpanded));
  tagsPanel.hidden = isExpanded;
  tagsToggle.textContent = isExpanded ? 'Ver tags da primeira linha' : 'Ocultar tags';
});
copiesToggle.addEventListener('click', () => {
  const isExpanded = copiesToggle.getAttribute('aria-expanded') === 'true';
  copiesToggle.setAttribute('aria-expanded', String(!isExpanded));
  copiesPanel.hidden = isExpanded;
  copiesToggle.textContent = isExpanded ? 'Adicionar Cc ou Cco' : 'Ocultar Cc e Cco';
});
previewButton.addEventListener('click', openPreview);
spreadsheetPreviewButton.addEventListener('click', openSpreadsheetPreview);
spreadsheetPreviewClose.addEventListener('click', closeSpreadsheetPreview);
previewClose.addEventListener('click', closePreview);
previewBack.addEventListener('click', closePreview);
previewSend.addEventListener('click', () => {
  closePreview();
  form.requestSubmit();
});
previewModal.addEventListener('click', (event) => {
  if (event.target === previewModal) closePreview();
});
spreadsheetPreviewModal.addEventListener('click', (event) => {
  if (event.target === spreadsheetPreviewModal) closeSpreadsheetPreview();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && previewModal.classList.contains('active')) closePreview();
  if (event.key === 'Escape' && spreadsheetPreviewModal.classList.contains('active')) closeSpreadsheetPreview();
});
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
  batchResults = { sent: 0, failed: 0, outcomeUnknown: 0, dailyQuota: false, apiDailyQuota: false, rateLimit: false };
  fileName.textContent = 'Nenhum arquivo selecionado';
  updateAttachmentSelection();
  tagsPanel.hidden = true;
  tagsToggle.setAttribute('aria-expanded', 'false');
  tagsToggle.textContent = 'Ver tags da primeira linha';
  copiesPanel.hidden = true;
  copiesToggle.setAttribute('aria-expanded', 'false');
  copiesToggle.textContent = 'Adicionar Cc ou Cco';
  progressPanel.hidden = true;
  progressBar.value = 0;
  progressBar.max = 1;
  progressCount.textContent = '0 / 0';
  progressStatus.textContent = 'Pronto para começar';
  progressDetail.textContent = 'O resultado de cada destinatário será registrado na aba Log-SaaS.';
  subjectInput.value = DEFAULT_SUBJECT;
  messageInput.value = DEFAULT_MESSAGE;
  renderContactsPreview();
  closeSpreadsheetPreview();
  closePreview();
  setStatus('', '');
  showToast('Formulário limpo e mensagem padrão restaurada.', 'success', 4000);
});

subjectInput.value = DEFAULT_SUBJECT;
messageInput.value = DEFAULT_MESSAGE;
updateVariableChips();
updateSubmitState();
window.addEventListener('load', initializeOAuth, { once: true });
