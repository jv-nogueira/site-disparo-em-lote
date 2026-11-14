const SPREADSHEET_NAME = 'DispararEmail';
const LOG_SHEET_NAME = 'Log';
const GOOGLE_CLIENT_ID = 'COLE_SEU_CLIENT_ID_AQUI';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GOOGLE_TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo?access_token=';
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const REQUIRED_GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const REQUIRED_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getLogSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getName() !== SPREADSHEET_NAME) {
    throw new Error('Vincule este Apps Script à planilha chamada "DispararEmail".');
  }
  const sheet = spreadsheet.getSheetByName(LOG_SHEET_NAME) || spreadsheet.insertSheet(LOG_SHEET_NAME);
  const expectedHeaders = ['Nome', 'E-mail', 'Data', 'Ator', 'Status'];
  const currentHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0];

  if (currentHeaders.every(function (value) { return !String(value).trim(); })) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
  } else {
    expectedHeaders.forEach(function (header, index) {
      if (!String(currentHeaders[index] || '').trim()) {
        sheet.getRange(1, index + 1).setValue(header);
      }
    });
  }
  return sheet;
}

function setupLog() {
  getLogSheet();
  UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v1/certs', { muteHttpExceptions: true });
  Logger.log('Aba Log pronta na planilha ' + SPREADSHEET_NAME + '.');
}

function getActorEmail(accessToken) {
  if (!accessToken || GOOGLE_CLIENT_ID === 'COLE_SEU_CLIENT_ID_AQUI') {
    const authError = new Error('Faça login novamente com uma conta Google autorizada.');
    authError.authRequired = true;
    throw authError;
  }

  const tokenResponse = UrlFetchApp.fetch(
    GOOGLE_TOKEN_INFO_URL + encodeURIComponent(accessToken),
    { muteHttpExceptions: true }
  );
  if (tokenResponse.getResponseCode() !== 200) {
    const authError = new Error('O token expirou ou não é válido. Entre novamente com o Google.');
    authError.authRequired = true;
    throw authError;
  }

  const tokenInfo = JSON.parse(tokenResponse.getContentText());
  const scopes = String(tokenInfo.scope || '').split(/\s+/);
  const clientAudience = tokenInfo.aud || tokenInfo.issued_to || tokenInfo.azp;
  if (
    scopes.indexOf(REQUIRED_GMAIL_SCOPE) < 0 ||
    (scopes.indexOf(REQUIRED_EMAIL_SCOPE) < 0 && scopes.indexOf('email') < 0) ||
    (clientAudience && clientAudience !== GOOGLE_CLIENT_ID)
  ) {
    const authError = new Error('O token não contém os escopos ou o Client ID esperados. Autorize novamente.');
    authError.authRequired = true;
    throw authError;
  }

  const userResponse = UrlFetchApp.fetch(GOOGLE_USER_INFO_URL, {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (userResponse.getResponseCode() !== 200) {
    const authError = new Error('Não foi possível identificar a conta Google autenticada.');
    authError.authRequired = true;
    throw authError;
  }

  const user = JSON.parse(userResponse.getContentText());
  if (!user.email || user.verified_email === false) {
    const authError = new Error('A conta autenticada não possui um e-mail verificado.');
    authError.authRequired = true;
    throw authError;
  }
  return String(user.email).trim().toLowerCase();
}

function sanitizeHeader(value, fieldName) {
  const text = String(value || '').trim();
  if (/[\r\n]/.test(text)) {
    throw new Error('O campo "' + fieldName + '" contém caracteres inválidos.');
  }
  return text;
}

function encodeSubject(subject) {
  const characters = Array.from(subject);
  const chunks = [];
  let chunk = '';
  let chunkBytes = 0;
  characters.forEach(function (character) {
    const characterBytes = Utilities.newBlob(character, 'text/plain; charset=UTF-8').getBytes().length;
    if (chunk && chunkBytes + characterBytes > 42) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  });
  if (chunk) chunks.push(chunk);
  return chunks.map(function (part) {
    const bytes = Utilities.newBlob(part, 'text/plain; charset=UTF-8').getBytes();
    return '=?UTF-8?B?' + Utilities.base64Encode(bytes) + '?=';
  }).join('\r\n ');
}

function encodeTextPart(text) {
  const normalized = String(text).replace(/\r\n|\r|\n/g, '\r\n');
  return wrapBase64(Utilities.base64Encode(Utilities.newBlob(normalized, 'text/plain; charset=UTF-8').getBytes()));
}

function wrapBase64(value) {
  return String(value).match(/.{1,76}/g).join('\r\n');
}

function createRawEmail(payload) {
  const recipient = sanitizeHeader(payload.recipientEmail, 'E-mail');
  const subject = sanitizeHeader(payload.subject, 'Assunto');
  const body = String(payload.message || '');
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) {
    throw new Error('O e-mail do destinatário é inválido.');
  }
  if (!subject) throw new Error('O assunto não pode ficar vazio.');
  if (!body.trim()) throw new Error('O corpo do e-mail não pode ficar vazio.');

  const headers = [
    'To: ' + recipient,
    'Subject: ' + encodeSubject(subject),
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0'
  ];
  let rawMessage;
  if (payload.fileData) {
    const fileName = sanitizeHeader(payload.fileName || 'anexo.pdf', 'Nome do anexo');
    if (!/\.pdf$/i.test(fileName) || (payload.fileMimeType && payload.fileMimeType !== 'application/pdf')) {
      throw new Error('O anexo precisa ser um arquivo PDF.');
    }
    const boundary = '=_GmailApi_' + Utilities.getUuid().replace(/-/g, '');
    const attachmentBytes = Utilities.base64Decode(String(payload.fileData));
    if (attachmentBytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error('O PDF ultrapassa o limite de 10 MB.');
    }
    if (Utilities.newBlob(attachmentBytes).getDataAsString().slice(0, 5) !== '%PDF-') {
      throw new Error('O conteúdo do anexo não parece ser um PDF válido.');
    }
    const attachmentBase64 = wrapBase64(Utilities.base64Encode(attachmentBytes));
    const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape);
    headers.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    rawMessage = headers.join('\r\n') + '\r\n\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      encodeTextPart(body) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/pdf; name*=UTF-8\'\'' + encodedFileName + '\r\n' +
      'Content-Disposition: attachment; filename*=UTF-8\'\'' + encodedFileName + '\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      attachmentBase64 + '\r\n' +
      '--' + boundary + '--';
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: base64');
    rawMessage = headers.join('\r\n') + '\r\n\r\n' + encodeTextPart(body);
  }

  const messageBytes = Utilities.newBlob(rawMessage, 'message/rfc822').getBytes();
  return Utilities.base64EncodeWebSafe(messageBytes).replace(/=+$/, '');
}

function sendWithGmailApi(payload, accessToken) {
  const raw = createRawEmail(payload);
  const response = UrlFetchApp.fetch(GMAIL_SEND_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({ raw: raw }),
    muteHttpExceptions: true
  });
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    let detail = response.getContentText();
    try {
      const apiError = JSON.parse(detail);
      detail = apiError.error && apiError.error.message ? apiError.error.message : detail;
    } catch (error) {
      detail = detail || 'Resposta vazia da Gmail API.';
    }
    const apiError = new Error('Gmail API (' + statusCode + '): ' + String(detail).slice(0, 500));
    apiError.authRequired = statusCode === 401;
    throw apiError;
  }
}

function insertLogRow(sheet, name, email, actorEmail, status) {
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, 5).setValues([[
    String(name || ''),
    String(email || ''),
    new Date(),
    actorEmail,
    status
  ]]);
}

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'API de envio em lote ativa.'
  });
}

function doPost(event) {
  let payload = {};
  try {
    const rawBody = event && event.postData && event.postData.contents;
    payload = rawBody ? JSON.parse(rawBody) : (event && event.parameter) || {};
  } catch (error) {
    return jsonResponse({ ok: false, logged: false, error: 'O corpo da solicitação não contém JSON válido.' });
  }

  let actorEmail;
  try {
    actorEmail = getActorEmail(payload.accessToken);
  } catch (error) {
    return jsonResponse({
      ok: false,
      logged: false,
      authRequired: error.authRequired === true,
      error: error.message || String(error)
    });
  }

  const recipient = String(payload.recipientEmail || '').trim();
  const name = String(payload.recipientName || '').trim();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    return jsonResponse({ ok: false, logged: false, error: 'Não foi possível reservar a fila do log. Tente novamente.' });
  }

  let sendError = '';
  let sendAuthRequired = false;
  try {
    let sheet;
    try {
      sheet = getLogSheet();
    } catch (logSetupError) {
      return jsonResponse({
        ok: false,
        logged: false,
        error: 'Não foi possível acessar a planilha de log: ' + (logSetupError.message || logSetupError)
      });
    }

    try {
      sendWithGmailApi(payload, payload.accessToken);
    } catch (error) {
      sendError = error.message || String(error);
      sendAuthRequired = error.authRequired === true;
    }

    try {
      insertLogRow(sheet, name, recipient, actorEmail, sendError ? 'Erro' : 'Enviado');
    } catch (logError) {
      return jsonResponse({
        ok: false,
        logged: false,
        sent: !sendError,
        error: (sendError ? sendError + ' ' : '') + 'Não foi possível gravar o resultado no Sheets: ' + (logError.message || logError)
      });
    }
  } finally {
    lock.releaseLock();
  }

  if (sendError) {
    return jsonResponse({
      ok: false,
      logged: true,
      status: 'Erro',
      authRequired: sendAuthRequired,
      error: sendError
    });
  }
  return jsonResponse({ ok: true, logged: true, status: 'Enviado' });
}
