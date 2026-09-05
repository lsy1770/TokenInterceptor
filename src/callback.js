'use strict';

const sentCandidates = new Set();

function sendCandidate(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (value.length < 8 || value.length > 4096 || sentCandidates.has(value)) return;
  sentCandidates.add(value);
  void chrome.runtime.sendMessage({ type: 'CLAUDE_CALLBACK_CANDIDATE', value });
}

function scanCallbackPage() {
  sendCandidate(window.location.href);
  sendCandidate(window.location.search);
  sendCandidate(window.location.hash);
  const elements = document.querySelectorAll(
    'input, textarea, code, pre, [data-testid*="code" i], [aria-label*="code" i]'
  );
  for (const element of Array.from(elements).slice(0, 50)) {
    sendCandidate(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.textContent);
  }
}

scanCallbackPage();
const observer = new MutationObserver(scanCallbackPage);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.setTimeout(() => observer.disconnect(), 120000);
