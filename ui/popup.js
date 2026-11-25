'use strict';

const $ = id => document.getElementById(id);
let openAITokens = [];
let previousOpenAICount = 0;
let currentClaudeToken = null;
let claudeTokensRevealed = false;
let currentAntigravityToken = null;
let antigravityTokensRevealed = false;
let currentGrokToken = null;
let grokTokensRevealed = false;
let capturedCredentials = null;
let openAIPollTimer = null;
let toastTimer = null;

function send(type, payload = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, ...payload }, response => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: '后台未返回结果' });
    });
  });
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

async function copyText(value, successMessage) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  showToast(successMessage);
}

function setButtonBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

// Platform navigation
function selectPlatform(platform) {
  document.body.dataset.platform = platform;
  document.querySelectorAll('.platform-button').forEach(button => {
    button.classList.toggle('active', button.dataset.platform === platform);
  });
  document.querySelectorAll('.platform-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `platform-${platform}`);
  });
  void chrome.storage.local.set({ selectedPlatform: platform });
  if (platform === 'claude') void refreshClaudeState();
  if (platform === 'antigravity') void refreshAntigravityState();
  if (platform === 'grok') void refreshGrokState();
  if (platform === 'google') void initializeGoogle();
}

document.querySelectorAll('.platform-button').forEach(button => {
  button.addEventListener('click', () => selectPlatform(button.dataset.platform));
});

document.querySelectorAll('.subtab').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.subtab').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.subtab-panel').forEach(panel => panel.classList.remove('active'));
    button.classList.add('active');
    $(`openai-tab-${button.dataset.tab}`).classList.add('active');
  });
});

// OpenAI flow
function setOpenAIStep(step) {
  for (let index = 1; index <= 4; index += 1) {
    const element = $(`openaiStep${index}`);
    element.classList.toggle('done', index < step);
    element.classList.toggle('active', index === step);
  }
}

async function syncOpenAIVerifier() {
  const response = await send('GET_VERIFIER');
  if (response.ok && response.verifier && !$('openaiVerifier').value) {
    $('openaiVerifier').value = response.verifier;
  }
}

function showOpenAIURL(url, opened) {
  $('openaiURL').value = url;
  $('openaiURLPanel').hidden = false;
  $('openaiURLStatus').textContent = opened ? '等待授权' : '已生成';
  void syncOpenAIVerifier();
}

async function initializeOpenAIURL() {
  const response = await send('GET_AUTH_URL');
  if (response.ok && response.url) {
    showOpenAIURL(response.url, false);
    setOpenAIStep(1);
  }
}

function startOpenAIPolling() {
  clearInterval(openAIPollTimer);
  setOpenAIStep(3);
  let polls = 0;
  openAIPollTimer = setInterval(async () => {
    polls += 1;
    const delta = await loadOpenAITokens();
    if (delta > 0) {
      clearInterval(openAIPollTimer);
      openAIPollTimer = null;
      setOpenAIStep(4);
      $('openaiStatus').textContent = '已完成';
      $('openaiStart').textContent = '再次发起授权';
      showToast('OpenAI Token 获取成功');
    } else if (polls >= 180) {
      clearInterval(openAIPollTimer);
      openAIPollTimer = null;
      $('openaiStatus').textContent = '已超时';
      $('openaiStart').textContent = '重新发起授权';
      showToast('等待回调超时，请重新发起');
    }
  }, 1000);
}

$('openaiStart').addEventListener('click', async () => {
  const button = $('openaiStart');
  setButtonBusy(button, true, '正在生成...', '生成并打开授权 URL');
  const response = await send('START_AUTH');
  setButtonBusy(button, false, '', response.ok ? '授权页已打开' : '重新发起授权');
  if (!response.ok) {
    showToast(`发起失败：${response.error || '未知错误'}`);
    return;
  }
  showOpenAIURL(response.url, true);
  setOpenAIStep(2);
  $('openaiStatus').textContent = '等待回调';
  startOpenAIPolling();
});

$('openaiOpenURL').addEventListener('click', async () => {
  const response = await send('OPEN_URL', { url: $('openaiURL').value });
  if (!response.ok) return showToast(`打开失败：${response.error}`);
  $('openaiURLStatus').textContent = '等待授权';
  $('openaiStatus').textContent = '等待回调';
  setOpenAIStep(2);
  startOpenAIPolling();
});

$('openaiCopyURL').addEventListener('click', () => copyText($('openaiURL').value, 'OpenAI 授权 URL 已复制'));

$('openaiRegenerate').addEventListener('click', async () => {
  if (!confirm('重新生成会使当前授权 URL 失效，确定继续吗？')) return;
  const response = await send('GET_AUTH_URL', { forceNew: true });
  if (!response.ok) return showToast(`生成失败：${response.error}`);
  showOpenAIURL(response.url, false);
  setOpenAIStep(1);
  $('openaiStatus').textContent = '就绪';
  showToast('已生成新的 OpenAI 授权 URL');
});

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tokenField(label, value) {
  if (!value) return '';
  return `<div class="token-row"><div class="token-row-label"><span>${label}</span><span>点击复制</span></div>`
    + `<div class="token-value" data-token-value="${encodeURIComponent(value)}">${escapeHTML(value)}</div></div>`;
}

const ICON = {
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3.5" y="10.5" width="17" height="10.5" rx="2.5"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="9" y="9" width="11.5" height="11.5" rx="2.5"/><path d="M5.5 15H4.8A1.3 1.3 0 0 1 3.5 13.7V4.8A1.3 1.3 0 0 1 4.8 3.5h8.9A1.3 1.3 0 0 1 15 4.8v.7"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 3.5v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v2.5A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2V16"/></svg>'
};

function renderOpenAITokens(tokens) {
  if (!tokens.length) {
    $('tokenList').innerHTML = `<div class="empty-state"><span class="empty-mark">${ICON.empty}</span>`
      + '<strong>尚无 Token</strong><p>从上方发起 OpenAI 授权后会显示在这里</p></div>';
    return;
  }

  const sources = {
    auto_callback: '自动回调',
    manual: '手动换取',
    page_capture: '页面捕获',
    session_import: 'Session 导入'
  };
  $('tokenList').innerHTML = tokens.map((token, index) => {
    const capturedAt = token.capturedAt ? new Date(token.capturedAt).toLocaleString('zh-CN') : '-';
    const hours = token.expires_in ? `${Math.round(token.expires_in / 3600)}h` : '未知时长';
    const scopes = String(token.scope || '').split(' ').filter(Boolean)
      .map(scope => `<span>${escapeHTML(scope)}</span>`).join('');
    return `<article class="token-card"><header class="token-card-header">`
      + `<span class="token-index">${index + 1}</span><div class="token-card-title">`
      + `<strong>${escapeHTML(sources[token.source] || token.source || 'OpenAI Token')}</strong>`
      + `<small>${escapeHTML(capturedAt)} · ${hours}</small></div>`
      + `<button class="icon-button" data-copy-openai="${index}" type="button" title="复制全部字段">${ICON.copy}</button>`
      + `<button class="icon-button" data-export-openai="${index}" type="button" title="导出 TXT">${ICON.download}</button></header>`
      + `<div class="token-fields">${tokenField('access_token', token.access_token)}`
      + `${tokenField('refresh_token', token.refresh_token)}${tokenField('id_token', token.id_token)}`
      + `${scopes ? `<div class="token-row"><div class="token-row-label"><span>scope</span></div><div class="scope-list">${scopes}</div></div>` : ''}`
      + '</div></article>';
  }).join('');
}

async function loadOpenAITokens() {
  const response = await send('GET_TOKENS');
  if (!response.ok) return 0;
  openAITokens = response.tokens || [];
  $('tokenCount').textContent = openAITokens.length;
  renderOpenAITokens(openAITokens);
  $('pendingCodePanel').hidden = !response.pendingCode;
  $('pendingCode').textContent = response.pendingCode || '';
  if (response.pendingCode && !$('openaiCode').value) $('openaiCode').value = response.pendingCode;
  if (response.pendingVerifier && !$('openaiVerifier').value) $('openaiVerifier').value = response.pendingVerifier;
  const delta = Math.max(0, openAITokens.length - previousOpenAICount);
  previousOpenAICount = openAITokens.length;
  return delta;
}

function formatOpenAIToken(token, index) {
  return [
    '='.repeat(64),
    `# OpenAI Token ${index + 1} · ${token.capturedAt || '-'} · ${token.source || '-'}`,
    '='.repeat(64),
    '', '[access_token]', token.access_token || '',
    '', '[refresh_token]', token.refresh_token || '',
    '', '[id_token]', token.id_token || '',
    '', '[token_type]', token.token_type || 'bearer',
    '', '[scope]', token.scope || '', ''
  ].join('\n');
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

$('tokenList').addEventListener('click', event => {
  const valueElement = event.target.closest('[data-token-value]');
  if (valueElement) {
    void copyText(decodeURIComponent(valueElement.dataset.tokenValue), 'Token 字段已复制');
    return;
  }
  const copyButton = event.target.closest('[data-copy-openai]');
  if (copyButton) {
    const index = Number(copyButton.dataset.copyOpenai);
    void copyText(formatOpenAIToken(openAITokens[index], index), 'OpenAI Token 已复制');
    return;
  }
  const exportButton = event.target.closest('[data-export-openai]');
  if (exportButton) {
    const index = Number(exportButton.dataset.exportOpenai);
    download(formatOpenAIToken(openAITokens[index], index), `openai_token_${Date.now()}.txt`, 'text/plain');
  }
});

$('exportOpenAITxt').addEventListener('click', () => {
  if (!openAITokens.length) return showToast('暂无 OpenAI Token');
  download(openAITokens.map(formatOpenAIToken).join('\n'), `openai_tokens_${Date.now()}.txt`, 'text/plain');
});
$('exportOpenAIJson').addEventListener('click', () => {
  if (!openAITokens.length) return showToast('暂无 OpenAI Token');
  download(JSON.stringify(openAITokens, null, 2), `openai_tokens_${Date.now()}.json`, 'application/json');
});
$('clearOpenAI').addEventListener('click', async () => {
  if (!confirm('确认清除全部 OpenAI Token 记录吗？')) return;
  const response = await send('CLEAR_TOKENS');
  if (!response.ok) return showToast(`清除失败：${response.error}`);
  openAITokens = [];
  previousOpenAICount = 0;
  $('tokenCount').textContent = '0';
  renderOpenAITokens([]);
  setOpenAIStep(0);
  $('openaiStatus').textContent = '就绪';
  showToast('OpenAI Token 已清除');
});

$('pendingCodePanel').addEventListener('click', () => copyText($('pendingCode').textContent, '授权码已复制'));
$('openaiManualExchange').addEventListener('click', async () => {
  const code = $('openaiCode').value.trim();
  const verifier = $('openaiVerifier').value.trim();
  if (!code || !verifier) return showToast('Authorization Code 和 Code Verifier 均为必填');
  const button = $('openaiManualExchange');
  setButtonBusy(button, true, '正在换取...', '手动换取 Token');
  const response = await send('MANUAL_EXCHANGE', { code, verifier });
  setButtonBusy(button, false, '', '手动换取 Token');
  if (!response.ok) return showToast(`换取失败：${response.error}`);
  await send('CLEAR_PENDING');
  await loadOpenAITokens();
  document.querySelector('.subtab[data-tab="tokens"]').click();
  showToast('OpenAI Token 换取成功');
});

$('importSession').addEventListener('click', async () => {
  const payload = $('sessionPayload').value.trim();
  if (!payload) return showToast('请粘贴 Session JSON 或 sessionToken');
  const button = $('importSession');
  const status = $('sessionStatus');
  setButtonBusy(button, true, '正在导入...', '导入并登录');
  status.textContent = '正在写入 chatgpt.com Cookie...';
  const response = await send('IMPORT_CHATGPT_SESSION', {
    payload,
    openChatGPT: $('openChatGPTAfterImport').checked
  });
  setButtonBusy(button, false, '', '导入并登录');
  if (!response.ok) {
    status.textContent = response.error || '导入失败';
    status.style.color = 'var(--danger)';
    return showToast(`导入失败：${response.error}`);
  }
  const details = [response.email, response.planType, response.expiresAt
    ? `有效至 ${new Date(response.expiresAt).toLocaleString('zh-CN')}` : ''].filter(Boolean);
  status.textContent = `导入成功${details.length ? ` · ${details.join(' · ')}` : ''}`;
  status.style.color = 'var(--success)';
  $('openaiStatus').textContent = 'Session 已导入';
  if (response.accessTokenStored) await loadOpenAITokens();
  showToast('ChatGPT Session 已导入');
});

// Grok SSO import flow
$('importGrokSSO').addEventListener('click', async () => {
  const payload = $('grokSSOPayload').value.trim();
  if (!payload) return showToast('请粘贴 Grok sso Cookie 或 Session JSON');
  const button = $('importGrokSSO');
  const status = $('grokSSOStatus');
  setButtonBusy(button, true, '正在导入...', '导入并登录');
  status.textContent = '正在写入 grok.com Cookie...';
  const response = await send('IMPORT_GROK_SSO', {
    payload,
    openGrok: $('openGrokAfterImport').checked
  });
  setButtonBusy(button, false, '', '导入并登录');
  if (!response.ok) {
    status.textContent = response.error || '导入失败';
    status.style.color = 'var(--danger)';
    return showToast(`导入失败：${response.error}`);
  }
  const details = [response.email, response.xUsername, response.expiresAt
    ? `有效至 ${new Date(response.expiresAt).toLocaleString('zh-CN')}` : ''].filter(Boolean);
  status.textContent = `导入成功${details.length ? ` · ${details.join(' · ')}` : ''}`;
  status.style.color = 'var(--success)';
  showToast('Grok SSO 已导入');
});

// Claude flow
function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function renderClaudeState(state) {
  const active = Boolean(state.captureActive);
  const exchanging = Boolean(state.oauthExchangeInProgress);
  const pending = Boolean(state.oauthCodeVerifier && state.oauthState);
  currentClaudeToken = state.capturedToken || null;
  $('claudeStateDot').className = 'state-dot';

  if (currentClaudeToken) {
    $('claudeStateDot').classList.add('success');
    $('claudeStatusTitle').textContent = 'Token 已捕获';
    $('claudeStatusDetail').textContent = '捕获已停止，Token 仅保存在本次浏览器会话。';
  } else if (exchanging) {
    $('claudeStateDot').classList.add('active');
    $('claudeStatusTitle').textContent = '正在交换 Token';
    $('claudeStatusDetail').textContent = '已识别 authorization code，正在请求 Claude Token 端点。';
  } else if (active) {
    $('claudeStateDot').classList.add('active');
    $('claudeStatusTitle').textContent = '正在监听 Claude';
    $('claudeStatusDetail').textContent = '请在 Claude 标签页完成 OAuth 请求。';
  } else if (pending) {
    $('claudeStateDot').classList.add('active');
    $('claudeStatusTitle').textContent = '等待 Claude 授权回调';
    $('claudeStatusDetail').textContent = '完成官方页面授权后将自动交换 Token。';
  } else {
    $('claudeStatusTitle').textContent = '未开始';
    $('claudeStatusDetail').textContent = '生成授权 URL，或监听已有 Claude Token 请求。';
  }

  $('claudeOpenAuth').disabled = exchanging;
  $('claudeExchange').disabled = exchanging;
  $('claudeListen').disabled = active;
  $('claudeStop').disabled = !active;
  $('claudeURLPanel').hidden = !state.oauthAuthorizeURL;
  $('claudeURL').value = state.oauthAuthorizeURL || '';
  $('claudeTokenPanel').hidden = !currentClaudeToken;
  $('claudeError').hidden = !state.captureError;
  $('claudeError').textContent = state.captureError || '';

  if (currentClaudeToken) {
    $('claudeAccessToken').value = currentClaudeToken.access_token || '';
    $('claudeRefreshToken').value = currentClaudeToken.refresh_token || '';
    $('claudeExpires').textContent = currentClaudeToken.expires_in ? `${currentClaudeToken.expires_in} 秒` : '-';
    $('claudeCapturedAt').textContent = formatTime(currentClaudeToken.captured_at);
  }
}

async function refreshClaudeState() {
  const response = await send('CLAUDE_GET_STATE');
  if (!response.ok) {
    $('claudeError').hidden = false;
    $('claudeError').textContent = response.error || '读取 Claude 状态失败';
    return;
  }
  renderClaudeState(response.state);
}

$('claudeOpenAuth').addEventListener('click', async () => {
  const button = $('claudeOpenAuth');
  setButtonBusy(button, true, '正在生成...', '生成并打开授权 URL');
  const response = await send('CLAUDE_GENERATE_AUTH');
  setButtonBusy(button, false, '', '生成并打开授权 URL');
  await refreshClaudeState();
  if (!response.ok) showToast(`Claude 授权失败：${response.error}`);
});
$('claudeCopyURL').addEventListener('click', () => copyText($('claudeURL').value, 'Claude 授权 URL 已复制'));
$('claudeExchange').addEventListener('click', async () => {
  const value = $('claudeCode').value.trim();
  if (!value) return showToast('请粘贴 Claude authorization code 或回调 URL');
  const response = await send('CLAUDE_EXCHANGE', { value });
  await refreshClaudeState();
  showToast(response.ok ? 'Claude Token 交换成功' : `交换失败：${response.error}`);
});
$('claudeListen').addEventListener('click', async () => {
  const response = await send('CLAUDE_CAPTURE_START');
  await refreshClaudeState();
  showToast(response.ok ? 'Claude 请求监听已启动' : `监听失败：${response.error}`);
});
$('claudeStop').addEventListener('click', async () => {
  await send('CLAUDE_CAPTURE_STOP');
  await refreshClaudeState();
});
$('claudeReveal').addEventListener('click', () => {
  claudeTokensRevealed = !claudeTokensRevealed;
  const type = claudeTokensRevealed ? 'text' : 'password';
  $('claudeAccessToken').type = type;
  $('claudeRefreshToken').type = type;
  $('claudeReveal').textContent = claudeTokensRevealed ? '隐藏 Token' : '显示 Token';
});
$('claudeCopy').addEventListener('click', () => {
  if (currentClaudeToken) void copyText(JSON.stringify(currentClaudeToken, null, 2), 'Claude Token JSON 已复制');
});
$('claudeClear').addEventListener('click', async () => {
  await send('CLAUDE_CLEAR');
  currentClaudeToken = null;
  claudeTokensRevealed = false;
  $('claudeAccessToken').type = 'password';
  $('claudeRefreshToken').type = 'password';
  $('claudeReveal').textContent = '显示 Token';
  await refreshClaudeState();
  showToast('Claude 会话数据已清除');
});

$('importClaudeSession').addEventListener('click', async () => {
  const payload = $('claudeSessionPayload').value.trim();
  if (!payload) return showToast('请粘贴 Claude sessionKey 或 Cookie 字符串');
  const button = $('importClaudeSession');
  const status = $('claudeSessionStatus');
  setButtonBusy(button, true, '正在导入...', '导入并登录');
  status.textContent = '正在写入 Claude Cookie...';
  const response = await send('IMPORT_CLAUDE_SESSION', {
    payload,
    openClaude: $('openClaudeAfterImport').checked
  });
  setButtonBusy(button, false, '', '导入并登录');
  if (!response.ok) {
    status.textContent = response.error || '导入失败';
    status.style.color = 'var(--danger)';
    return showToast(`导入失败：${response.error}`);
  }
  const details = [response.expiresAt
    ? `有效至 ${new Date(response.expiresAt).toLocaleString('zh-CN')}` : ''].filter(Boolean);
  status.textContent = `导入成功${details.length ? ` · ${details.join(' · ')}` : ''}`;
  status.style.color = 'var(--success)';
  showToast('Claude Session 已导入');
});

// Antigravity flow
function renderAntigravityState(state) {
  currentAntigravityToken = state.capturedToken || null;
  $('antigravityStateDot').className = 'state-dot';

  if (currentAntigravityToken) {
    $('antigravityStateDot').classList.add('success');
    $('antigravityStatusTitle').textContent = 'Token 已获取';
    $('antigravityStatusDetail').textContent = '凭据仅保存在本次浏览器会话，可复制 JSON 导出。';
  } else if (state.exchanging) {
    $('antigravityStateDot').classList.add('active');
    $('antigravityStatusTitle').textContent = '正在交换 Token';
    $('antigravityStatusDetail').textContent = '正在请求 Google OAuth Token 端点。';
  } else if (state.oauthPending) {
    $('antigravityStateDot').classList.add('active');
    $('antigravityStatusTitle').textContent = '等待 Google 授权回调';
    $('antigravityStatusDetail').textContent = '回调到 localhost:1456 后将自动完成 Token 交换。';
  } else {
    $('antigravityStatusTitle').textContent = '未开始';
    $('antigravityStatusDetail').textContent = '点击按钮生成 Google 授权 URL。';
  }

  $('antigravityOpenAuth').disabled = state.exchanging;
  $('antigravityExchange').disabled = state.exchanging;
  $('antigravityURLPanel').hidden = !state.oauthAuthorizeURL;
  $('antigravityURL').value = state.oauthAuthorizeURL || '';
  $('antigravityTokenPanel').hidden = !currentAntigravityToken;
  $('antigravityError').hidden = !state.error;
  $('antigravityError').textContent = state.error || '';

  if (currentAntigravityToken) {
    $('antigravityEmail').textContent = currentAntigravityToken.email || '-';
    $('antigravityName').textContent = currentAntigravityToken.name || '-';
    $('antigravityAccessToken').value = currentAntigravityToken.access_token || '';
    $('antigravityRefreshToken').value = currentAntigravityToken.refresh_token || '';
    $('antigravityIDToken').value = currentAntigravityToken.id_token || '';
    $('antigravityExpires').textContent = currentAntigravityToken.expires_in
      ? `${currentAntigravityToken.expires_in} 秒`
      : '-';
    $('antigravityCapturedAt').textContent = formatTime(currentAntigravityToken.captured_at);
  }
}

async function refreshAntigravityState() {
  const response = await send('ANTIGRAVITY_GET_STATE');
  if (!response.ok) {
    $('antigravityError').hidden = false;
    $('antigravityError').textContent = response.error || '读取 Antigravity 状态失败';
    return;
  }
  renderAntigravityState(response.state);
}

$('antigravityOpenAuth').addEventListener('click', async () => {
  const button = $('antigravityOpenAuth');
  setButtonBusy(button, true, '正在生成...', '生成并打开授权 URL');
  const response = await send('ANTIGRAVITY_GENERATE_AUTH');
  setButtonBusy(button, false, '', '生成并打开授权 URL');
  await refreshAntigravityState();
  showToast(response.ok ? 'Antigravity 授权页已打开' : `生成失败：${response.error}`);
});

$('antigravityCopyURL').addEventListener('click', () => (
  copyText($('antigravityURL').value, 'Antigravity 授权 URL 已复制')
));

$('antigravityExchange').addEventListener('click', async () => {
  const value = $('antigravityCode').value.trim();
  if (!value) return showToast('请粘贴 Antigravity authorization code 或回调 URL');
  const response = await send('ANTIGRAVITY_EXCHANGE', { value });
  await refreshAntigravityState();
  showToast(response.ok ? 'Antigravity Token 交换成功' : `交换失败：${response.error}`);
});

$('antigravityReveal').addEventListener('click', () => {
  antigravityTokensRevealed = !antigravityTokensRevealed;
  const type = antigravityTokensRevealed ? 'text' : 'password';
  $('antigravityAccessToken').type = type;
  $('antigravityRefreshToken').type = type;
  $('antigravityIDToken').type = type;
  $('antigravityReveal').textContent = antigravityTokensRevealed ? '隐藏 Token' : '显示 Token';
});

$('antigravityCopy').addEventListener('click', () => {
  if (currentAntigravityToken) {
    void copyText(JSON.stringify(currentAntigravityToken, null, 2), 'Antigravity Token JSON 已复制');
  }
});

$('antigravityClear').addEventListener('click', async () => {
  await send('ANTIGRAVITY_CLEAR');
  currentAntigravityToken = null;
  antigravityTokensRevealed = false;
  $('antigravityAccessToken').type = 'password';
  $('antigravityRefreshToken').type = 'password';
  $('antigravityIDToken').type = 'password';
  $('antigravityReveal').textContent = '显示 Token';
  await refreshAntigravityState();
  showToast('Antigravity 会话数据已清除');
});

// Grok OAuth flow
function renderGrokState(state) {
  currentGrokToken = state.capturedToken || null;
  $('grokStateDot').className = 'state-dot';

  if (currentGrokToken) {
    $('grokStateDot').classList.add('success');
    $('grokStatusTitle').textContent = 'Token 已获取';
    $('grokStatusDetail').textContent = '凭据仅保存在本次浏览器会话，可复制 JSON 导出。';
  } else if (state.exchanging) {
    $('grokStateDot').classList.add('active');
    $('grokStatusTitle').textContent = '正在交换 Token';
    $('grokStatusDetail').textContent = '已识别 authorization code，正在请求 Grok Token 端点。';
  } else if (state.oauthPending) {
    $('grokStateDot').classList.add('active');
    $('grokStatusTitle').textContent = '等待 Grok 授权回调';
    $('grokStatusDetail').textContent = '回调到 127.0.0.1:51234 后将自动完成 Token 交换。';
  } else {
    $('grokStatusTitle').textContent = '未开始';
    $('grokStatusDetail').textContent = '点击按钮生成 Grok 授权 URL。';
  }

  $('grokOpenAuth').disabled = state.exchanging;
  $('grokExchange').disabled = state.exchanging;
  $('grokURLPanel').hidden = !state.oauthAuthorizeURL;
  $('grokURL').value = state.oauthAuthorizeURL || '';
  $('grokTokenPanel').hidden = !currentGrokToken;
  $('grokError').hidden = !state.error;
  $('grokError').textContent = state.error || '';

  if (currentGrokToken) {
    $('grokEmail').textContent = currentGrokToken.email || '-';
    $('grokName').textContent = currentGrokToken.name || '-';
    $('grokAccessToken').value = currentGrokToken.access_token || '';
    $('grokRefreshToken').value = currentGrokToken.refresh_token || '';
    $('grokIDToken').value = currentGrokToken.id_token || '';
    $('grokExpires').textContent = currentGrokToken.expires_in
      ? `${currentGrokToken.expires_in} 秒`
      : '-';
    $('grokCapturedAt').textContent = formatTime(currentGrokToken.captured_at);
  }
}

async function refreshGrokState() {
  const response = await send('GROK_GET_STATE');
  if (!response.ok) {
    $('grokError').hidden = false;
    $('grokError').textContent = response.error || '读取 Grok 状态失败';
    return;
  }
  renderGrokState(response.state);
}

$('grokOpenAuth').addEventListener('click', async () => {
  const button = $('grokOpenAuth');
  setButtonBusy(button, true, '正在生成...', '生成并打开授权 URL');
  const response = await send('GROK_GENERATE_AUTH');
  setButtonBusy(button, false, '', '生成并打开授权 URL');
  await refreshGrokState();
  showToast(response.ok ? 'Grok 授权页已打开' : `生成失败：${response.error}`);
});

$('grokCopyURL').addEventListener('click', () => (
  copyText($('grokURL').value, 'Grok 授权 URL 已复制')
));

$('grokExchange').addEventListener('click', async () => {
  const value = $('grokCode').value.trim();
  if (!value) return showToast('请粘贴 Grok authorization code 或回调 URL');
  const response = await send('GROK_EXCHANGE', { value });
  await refreshGrokState();
  showToast(response.ok ? 'Grok Token 交换成功' : `交换失败：${response.error}`);
});

$('grokReveal').addEventListener('click', () => {
  grokTokensRevealed = !grokTokensRevealed;
  const type = grokTokensRevealed ? 'text' : 'password';
  $('grokAccessToken').type = type;
  $('grokRefreshToken').type = type;
  $('grokIDToken').type = type;
  $('grokReveal').textContent = grokTokensRevealed ? '隐藏 Token' : '显示 Token';
});

$('grokCopy').addEventListener('click', () => {
  if (currentGrokToken) {
    void copyText(JSON.stringify(currentGrokToken, null, 2), 'Grok Token JSON 已复制');
  }
});

$('grokClear').addEventListener('click', async () => {
  await send('GROK_CLEAR');
  currentGrokToken = null;
  grokTokensRevealed = false;
  $('grokAccessToken').type = 'password';
  $('grokRefreshToken').type = 'password';
  $('grokIDToken').type = 'password';
  $('grokReveal').textContent = '显示 Token';
  await refreshGrokState();
  showToast('Grok 会话数据已清除');
});

// Google One / Gemini 订阅凭据
let googleCaptureResult = null;

document.querySelectorAll('[data-google-tab]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-google-tab]').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('#platform-google .subtab-panel').forEach(panel => panel.classList.remove('active'));
    button.classList.add('active');
    $(`google-tab-${button.dataset.googleTab}`).classList.add('active');
  });
});

function setGoogleStatus(text, tone) {
  $('googleStatus').textContent = text;
  const status = $('googleExportStatus');
  if (status) {
    status.style.color = tone === 'error' ? 'var(--danger)'
      : tone === 'warning' ? 'var(--warning)' : 'var(--success)';
  }
}

function renderGoogleReadout(state) {
  const readout = $('googleReadout');
  if (!state) {
    readout.hidden = true;
    return;
  }
  readout.hidden = false;
  $('googleAccount').textContent = state.email || (state.loggedIn ? '已登录（未解析到邮箱）' : '未登录');
  $('googleGaia').textContent = state.gaia || '-';
  const caps = [];
  caps.push(state.hasSapisid ? 'SAPISID ✓' : 'SAPISID ✗');
  caps.push(state.hasStrong ? '强会话 ✓' : '强会话 ✗');
  if (state.finalUrl && /signin/.test(state.finalUrl)) caps.push('需登录');
  $('googleCapability').textContent = caps.join(' · ');
}

async function probeGoogle() {
  const response = await send('GOOGLE_PROBE');
  if (!response.ok) {
    setGoogleStatus('检测失败', 'error');
    $('googleExportStatus').textContent = response.error || '检测失败';
    return;
  }
  renderGoogleReadout(response.state);
  setGoogleStatus(response.state && response.state.hasSapisid ? '凭据齐备' : '缺少强会话');
}

$('googleProbe').addEventListener('click', () => { void probeGoogle(); });

const SITE_LABELS = {
  gemini: 'Gemini',
  play: 'Play 订阅页',
  one: 'Google One',
  accounts: '账号中心',
};

let googlePendingSites = [];

function renderGoogleSites(sites, hintText) {
  const panel = $('googleSitePanel');
  const list = $('googleSiteList');
  if (!sites || !sites.length) {
    panel.hidden = true;
    list.innerHTML = '';
    return;
  }
  panel.hidden = false;
  googlePendingSites = sites.filter(s => !s.ok).map(s => s.key);
  $('googleSiteHint').textContent = hintText
    || (googlePendingSites.length ? `${googlePendingSites.length} 个站点待登录` : '全部就绪');
  list.innerHTML = sites.map(site => {
    const ok = site && site.ok;
    const label = SITE_LABELS[site.key] || site.key;
    const note = site.hint || (site.error ? site.error : '');
    return `<li class="${ok ? 'ok' : ''}"><span class="site-dot"></span>`
      + `<span class="site-name">${label}</span>`
      + `<span class="site-note">${note}</span></li>`;
  }).join('');
}

$('googleCapture').addEventListener('click', async () => {
  const button = $('googleCapture');
  setButtonBusy(button, true, '正在读取…', '一键取 Cookie');
  $('googleExportStatus').textContent = '正在读取 google.com 域下的登录 Cookie…';
  const response = await send('GOOGLE_CAPTURE_CREDENTIALS', {});
  setButtonBusy(button, false, '', '一键取 Cookie');
  if (!response.ok) {
    setGoogleStatus('导出失败', 'error');
    $('googleExportStatus').textContent = response.error || '导出失败';
    return;
  }
  // Cookie 不全：先看实测结果，再把真正不通的站点打开
  if (response.needsLogin) {
    const probed = response.probedSites || [];
    const opened = response.openedSites || [];
    const rows = (probed.length ? probed : opened.map(s => ({
      key: s.key,
      ok: false,
      hint: s.error ? `打开失败：${s.error}` : '已打开，请在该页面完成登录',
    })));
    renderGoogleSites(rows, '需要登录');
    setGoogleStatus('Cookie 不完整', 'warning');
    $('googleExportStatus').textContent = response.message || 'Cookie 不完整';
    showToast(response.message || 'Cookie 不完整');
    return;
  }
  await applyGoogleCapture(response);
});

async function applyGoogleCapture(response) {
  googleCaptureResult = response;
  $('googleCookiesTxt').value = response.cookiesTxt || '';
  $('googleCookieHeader').value = response.cookieHeader || '';
  $('googleCredsJSON').value = JSON.stringify({
    provider: response.provider,
    capturedAt: response.capturedAt,
    purpose: response.purpose,
    summary: response.summary,
    credentials: response.credentials,
    cookies: response.cookies
  }, null, 2);
  $('googlePythonSnippet').value = response.python || '';

  const summary = response.summary || {};
  const bucketText = Object.entries(summary.buckets || {})
    .map(([key, names]) => `${key}:${names.length}`).join(' ');
  const criticalMissing = summary.criticalMissing || [];
  $('googleExportStatus').textContent = [
    `共 ${summary.total || 0} 条 Cookie`,
    `判定 ${summary.verdict || '?'}`,
    bucketText,
    // 关键项缺了单独点出来：这些缺一个，Python 侧就会掉进登录页
    criticalMissing.length ? `关键缺：${criticalMissing.join(' / ')}` : '关键项齐全',
    summary.canCancel ? '可取消续费' : `缺：${(summary.missing || []).join(' / ')}`
  ].filter(Boolean).join(' · ');

  // PSIDTS 是否在导出前被刷新过（旧值会让脚本一跑就 302 到登录页）
  const refresh = response.sessionRefresh || {};
  if (refresh.rotated && refresh.rotated.length) {
    $('googleExportStatus').textContent += ` · 已刷新 ${refresh.rotated.join('/')}`;
  }

  setGoogleStatus(summary.canCancel && !criticalMissing.length ? '已导出' : '部分可用',
    summary.canCancel && !criticalMissing.length ? 'ok' : 'warning');
  renderGoogleReadout({
    hasSapisid: summary.hasSapisid,
    hasStrong: summary.hasStrong,
    loggedIn: true
  });
  showToast(`已取到 ${summary.total || 0} 条 Google Cookie`);
}

$('googleRetryCapture').addEventListener('click', async () => {
  const button = $('googleRetryCapture');
  setButtonBusy(button, true, '正在核对…', '我已登录，继续取 Cookie');
  // force=true：绕过 60s 缓存，按标签页真实状态重新判一次
  const probe = await send('GOOGLE_PROBE_SITES', { reset: true });
  if (probe.ok) renderGoogleSites(probe.sites, undefined);
  const response = await send('GOOGLE_CAPTURE_CREDENTIALS', {
    retried: true,
    force: true,
    autoComplete: true,
  });
  setButtonBusy(button, false, '', '我已登录，继续取 Cookie');
  if (!response.ok) {
    $('googleExportStatus').textContent = response.error || '仍然取不到 Cookie';
    setGoogleStatus('导出失败', 'error');
    return;
  }
  if (response.needsLogin) {
    const rows = (response.probedSites || []).map(s => ({ key: s.key, ok: s.ok, hint: s.hint }));
    renderGoogleSites(rows, '需要登录');
    setGoogleStatus('仍未就绪', 'warning');
    $('googleExportStatus').textContent = response.message || '仍未就绪';
    showToast(response.message || '仍未就绪');
    return;
  }
  await applyGoogleCapture(response);
  const rows = (response.probedSites || []).map(s => ({ key: s.key, ok: s.ok, hint: s.hint }));
  renderGoogleSites(rows, rows.length ? '全部就绪' : undefined);
  document.querySelector('[data-google-tab="export"]').click();
});

$('googleOpenMissing').addEventListener('click', async () => {
  const keys = googlePendingSites.length ? googlePendingSites : ['gemini', 'play', 'one', 'accounts'];
  const response = await send('GOOGLE_OPEN_SITES', { sites: keys });
  if (!response.ok) return showToast(`打开失败：${response.error}`);
  showToast(`已打开 ${response.opened.length} 个站点`);
});

$('googleCopyTxt').addEventListener('click', () => {
  if (!$('googleCookiesTxt').value) return showToast('先点「一键取 Cookie」');
  void copyText($('googleCookiesTxt').value, 'cookies.txt 已复制');
});

$('googleCopyHeader').addEventListener('click', () => {
  if (!$('googleCookieHeader').value) return showToast('先点「一键取 Cookie」');
  void copyText($('googleCookieHeader').value, 'Cookie Header 已复制');
});

$('googleCopyJson').addEventListener('click', () => {
  if (!$('googleCredsJSON').value) return showToast('先点「一键取 Cookie」');
  void copyText($('googleCredsJSON').value, 'JSON 已复制');
});

$('googleCopyPython').addEventListener('click', () => {
  if (!$('googlePythonSnippet').value) return showToast('先点「一键取 Cookie」');
  void copyText($('googlePythonSnippet').value, 'Python 片段已复制');
});

$('googleSaveTxt').addEventListener('click', () => {
  if (!googleCaptureResult || !googleCaptureResult.cookiesTxt) return showToast('先点「一键取 Cookie」');
  download(googleCaptureResult.cookiesTxt, `google_cookies_${Date.now()}.txt`, 'text/plain');
});

async function refreshGoogleBackupInfo() {
  const response = await send('GOOGLE_BACKUP_INFO');
  const info = response.ok ? response.info : null;
  $('googleBackupInfo').textContent = info && info.exists
    ? `${info.count} 条 · ${new Date(info.savedAt).toLocaleString('zh-CN', { hour12: false })}`
    : '无';
}

$('googleInject').addEventListener('click', async () => {
  const payload = $('googleInjectPayload').value.trim();
  const status = $('googleInjectStatus');
  if (!payload) return showToast('请粘贴 cookie 内容');
  const button = $('googleInject');
  setButtonBusy(button, true, '正在注入…', '注入并登录');
  status.textContent = '正在写入 Cookie…';
  status.style.color = '';
  const response = await send('GOOGLE_INJECT_COOKIES', {
    payload,
    clearFirst: $('googleClearBeforeInject').checked,
    openTarget: $('googleOpenAfterInject').checked ? 'subscriptions' : ''
  });
  setButtonBusy(button, false, '', '注入并登录');
  if (!response.ok) {
    status.textContent = response.error || (response.errors || []).join('；') || '注入失败';
    status.style.color = 'var(--danger)';
    setGoogleStatus('注入失败', 'error');
    return;
  }
  status.style.color = 'var(--success)';
  status.textContent = `写入 ${response.written.length} 条（覆盖 ${response.overwritten.length} 条）`
    + `${response.hasSapisid ? ' · SAPISID 已生效' : ' · 未检测到 SAPISID'}`
    + `${response.opened ? ' · 已打开订阅页' : ''}`;
  setGoogleStatus('已注入', 'ok');
  await refreshGoogleBackupInfo();
  await probeGoogle();
  showToast('Google Cookie 已注入');
});

$('googleRestore').addEventListener('click', async () => {
  const response = await send('GOOGLE_RESTORE_BACKUP');
  if (!response.ok) return showToast(`回滚失败：${response.error}`);
  showToast(`已恢复 ${response.restored} 条 Cookie`);
  await refreshGoogleBackupInfo();
  await probeGoogle();
});

$('googleClearBackup').addEventListener('click', async () => {
  await send('GOOGLE_CLEAR_BACKUP');
  await refreshGoogleBackupInfo();
  showToast('快照已清除');
});

async function initializeGoogle() {
  const response = await send('GOOGLE_LAST_EXPORT');
  if (response.ok && response.info) {
    $('googleExportStatus').textContent =
      `上次导出：${new Date(response.info.capturedAt).toLocaleString('zh-CN', { hour12: false })}`
      + ` · ${response.info.summary ? response.info.summary.total : 0} 条`;
  }
  await refreshGoogleBackupInfo();
  await probeGoogle();
}

// Credential capture
function renderCredentials(result) {
  capturedCredentials = {
    capturedAt: result.capturedAt,
    ...(result.credentials || {})
  };
  $('credentialsJSON').value = JSON.stringify(capturedCredentials, null, 2);
  const capturedCount = Object.keys(result.credentials || {}).length;
  const errorCount = Object.keys(result.errors || {}).length;
  if (capturedCount && errorCount) {
    $('credentialStatus').textContent = `${capturedCount} 项成功 · ${errorCount} 项失败`;
  } else if (capturedCount) {
    $('credentialStatus').textContent = `已捕获 ${capturedCount} 项`;
  } else if (errorCount) {
    $('credentialStatus').textContent = '捕获失败';
  } else {
    $('credentialStatus').textContent = '就绪';
  }
}

async function doCapture(provider) {
  const status = $('credentialsStatus');
  status.textContent = '正在捕获…';
  const response = await send('CAPTURE_CREDENTIALS', { provider });
  if (!response.ok) {
    status.textContent = response.error || '捕获失败';
    status.style.color = 'var(--danger)';
    return;
  }
  renderCredentials(response);
  const errors = Object.values(response.errors || {});
  status.textContent = errors.length ? `部分失败：${errors.join('；')}` : '捕获完成';
  status.style.color = errors.length ? 'var(--warning)' : 'var(--success)';
}

$('captureAllCredentials').addEventListener('click', () => doCapture('all'));
$('captureOpenAI').addEventListener('click', () => doCapture('openai'));
$('captureClaude').addEventListener('click', () => doCapture('claude'));
$('captureGrok').addEventListener('click', () => doCapture('grok'));

$('copyCredentials').addEventListener('click', () => {
  if (!capturedCredentials) return showToast('尚未捕获凭据');
  void copyText(JSON.stringify(capturedCredentials, null, 2), '凭据 JSON 已复制');
});

$('exportCredentials').addEventListener('click', () => {
  if (!capturedCredentials) return showToast('尚未捕获凭据');
  download(JSON.stringify(capturedCredentials, null, 2), `credentials_${Date.now()}.json`, 'application/json');
});

$('clearCredentials').addEventListener('click', () => {
  capturedCredentials = null;
  $('credentialsJSON').value = '';
  $('credentialStatus').textContent = '就绪';
  $('credentialsStatus').textContent = '';
  showToast('已清除凭据');
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === 'session') {
    void refreshClaudeState();
    void refreshAntigravityState();
    void refreshGrokState();
  }
});

async function initialize() {
  const stored = await chrome.storage.local.get('selectedPlatform');
  const validPlatforms = new Set(['openai', 'claude', 'antigravity', 'grok', 'google', 'credentials']);
  selectPlatform(validPlatforms.has(stored.selectedPlatform) ? stored.selectedPlatform : 'openai');
  await Promise.all([
    initializeOpenAIURL(),
    loadOpenAITokens(),
    refreshClaudeState(),
    refreshAntigravityState(),
    refreshGrokState(),
    refreshGoogleBackupInfo()
  ]);
  setInterval(loadOpenAITokens, 2000);
}

void initialize();
