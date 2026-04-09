/**
 * ChatBot Widget — Self-contained vanilla JS
 * Embed: <script src="https://your-server.com/widget/chatbot-widget.js" data-chatbot-id="ID" async></script>
 */
(function () {
  'use strict';

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  const scriptTag = document.currentScript || document.querySelector('script[data-chatbot-id]');
  if (!scriptTag) return console.error('[ChatBot] Could not find script tag with data-chatbot-id');

  const CHATBOT_ID = scriptTag.dataset.chatbotId;
  if (!CHATBOT_ID) return console.error('[ChatBot] data-chatbot-id attribute is required');

  const API_BASE = new URL(scriptTag.src).origin;

  const STARTER_PROMPTS = [
    'What services do you offer?',
    'What is your contact information?',
  ];

  // ─── State ─────────────────────────────────────────────────────────────────

  let botConfig = null;
  let sessionId = null;
  let isOpen = false;
  let isTyping = false;
  let teaserDismissed = false;
  let elements = {};

  // ─── Config Fetch ───────────────────────────────────────────────────────────

  async function loadConfig() {
    try {
      const res = await fetch(`${API_BASE}/chatbot/${CHATBOT_ID}/config`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      botConfig = await res.json();
      initWidget();
    } catch (err) {
      console.error(`[ChatBot] Failed to load config: ${err.message}`);
    }
  }

  // ─── Styles ────────────────────────────────────────────────────────────────

  function injectStyles(primaryColor) {
    const css = `
      #chatbot-launcher {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: ${primaryColor};
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999998;
        transition: transform 0.2s, box-shadow 0.2s;
        outline: none;
      }
      #chatbot-launcher:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 24px rgba(0,0,0,0.3);
      }
      #chatbot-launcher svg { pointer-events: none; }

      /* ── Teaser bubble ── */
      #chatbot-teaser {
        position: fixed;
        bottom: 90px;
        right: 24px;
        background: #fff;
        color: #1a1a1a;
        padding: 14px 18px;
        border-radius: 18px 18px 4px 18px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
        max-width: 260px;
        z-index: 999997;
        cursor: pointer;
        animation: cb-fade-in 0.3s ease;
        line-height: 1.5;
        font-weight: 500;
      }
      #chatbot-teaser:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.2); }
      #chatbot-teaser-close {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #999;
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        padding: 0;
      }
      #chatbot-teaser-close:hover { background: #666; }

      #chatbot-window {
        position: fixed;
        bottom: 92px;
        right: 24px;
        width: 360px;
        height: 540px;
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.18);
        display: flex;
        flex-direction: column;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        overflow: hidden;
        transform: scale(0.95) translateY(10px);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.2s ease, opacity 0.2s ease;
      }
      #chatbot-window.open {
        transform: scale(1) translateY(0);
        opacity: 1;
        pointer-events: all;
      }
      #chatbot-header {
        background: ${primaryColor};
        color: #fff;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      #chatbot-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255,255,255,0.25);
        overflow: hidden;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #chatbot-avatar img { width: 100%; height: 100%; object-fit: cover; }
      #chatbot-title { font-weight: 600; font-size: 15px; }
      #chatbot-subtitle { font-size: 11px; opacity: 0.8; margin-top: 1px; }
      #chatbot-header-text { flex: 1; min-width: 0; }
      #chatbot-close {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        opacity: 0.8;
        transition: opacity 0.15s, background 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        align-self: flex-start;
        margin-top: -2px;
      }
      #chatbot-close:hover { opacity: 1; background: rgba(255,255,255,0.15); }
      #chatbot-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        scroll-behavior: smooth;
      }
      #chatbot-messages::-webkit-scrollbar { width: 4px; }
      #chatbot-messages::-webkit-scrollbar-track { background: #f1f1f1; }
      #chatbot-messages::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
      .cb-msg {
        max-width: 82%;
        padding: 10px 13px;
        border-radius: 16px;
        line-height: 1.5;
        word-break: break-word;
        animation: cb-fade-in 0.2s ease;
      }
      @keyframes cb-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .cb-msg.user {
        background: ${primaryColor};
        color: #fff;
        align-self: flex-end;
        border-bottom-right-radius: 4px;
      }
      .cb-msg.bot {
        background: #f0f2f5;
        color: #1a1a1a;
        align-self: flex-start;
        border-bottom-left-radius: 4px;
      }
      .cb-msg.error {
        background: #fff0f0;
        color: #cc0000;
        align-self: flex-start;
        border: 1px solid #ffcccc;
        border-bottom-left-radius: 4px;
      }

      /* ── Starter prompts ── */
      #chatbot-starters {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        padding: 0 16px 4px;
        animation: cb-fade-in 0.3s ease;
      }
      .cb-starter {
        background: #fff;
        border: 1.5px solid ${primaryColor};
        color: ${primaryColor};
        border-radius: 18px;
        padding: 8px 14px;
        font-size: 13px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s, color 0.15s;
        text-align: right;
      }
      .cb-starter:hover {
        background: ${primaryColor};
        color: #fff;
      }

      #chatbot-typing {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 10px 14px;
        background: #f0f2f5;
        border-radius: 16px;
        border-bottom-left-radius: 4px;
        align-self: flex-start;
        animation: cb-fade-in 0.2s ease;
      }
      #chatbot-typing span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #999;
        animation: cb-bounce 1.2s infinite;
      }
      #chatbot-typing span:nth-child(2) { animation-delay: 0.15s; }
      #chatbot-typing span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes cb-bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40%            { transform: translateY(-5px); }
      }
      #chatbot-input-area {
        padding: 12px;
        border-top: 1px solid #e8e8e8;
        display: flex;
        gap: 8px;
        flex-shrink: 0;
        background: #fff;
      }
      #chatbot-input {
        flex: 1;
        border: 1px solid #ddd;
        border-radius: 22px;
        padding: 9px 14px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        resize: none;
        max-height: 80px;
        overflow-y: auto;
        transition: border-color 0.15s;
        line-height: 1.4;
      }
      #chatbot-input:focus { border-color: ${primaryColor}; }
      #chatbot-input::placeholder { color: #aaa; }
      #chatbot-send {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: none;
        background: ${primaryColor};
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: opacity 0.15s;
        align-self: flex-end;
      }
      #chatbot-send:disabled { opacity: 0.4; cursor: default; }
      #chatbot-send:not(:disabled):hover { opacity: 0.85; }
      #chatbot-powered {
        text-align: center;
        font-size: 10px;
        color: #bbb;
        padding: 4px 0 6px;
      }
      @media (max-width: 480px) {
        #chatbot-window {
          bottom: 0; right: 0; left: 0;
          width: 100%; height: 90vh;
          border-radius: 16px 16px 0 0;
        }
        #chatbot-launcher { bottom: 16px; right: 16px; }
        #chatbot-teaser { right: 16px; bottom: 82px; }
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── DOM Builder ───────────────────────────────────────────────────────────

  function buildWidget() {
    const { name, primaryColor, profileImage, welcomeMessage } = botConfig;

    // ── Teaser bubble ──
    const teaser = document.createElement('div');
    teaser.id = 'chatbot-teaser';
    const teaserText = botConfig.teaserMessage || 'Hey! How can I help you?';
    teaser.innerHTML = `
      <button id="chatbot-teaser-close" aria-label="Dismiss">&#x2715;</button>
      ${escapeHtml(teaserText)}
    `;
    teaser.addEventListener('click', (e) => {
      if (e.target.id === 'chatbot-teaser-close') {
        dismissTeaser();
      } else {
        dismissTeaser();
        if (!isOpen) toggleWidget();
      }
    });
    document.body.appendChild(teaser);
    elements.teaser = teaser;

    // ── Launcher button ──
    const launcher = document.createElement('button');
    launcher.id = 'chatbot-launcher';
    launcher.setAttribute('aria-label', `Open ${name} chat`);
    launcher.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>`;
    launcher.addEventListener('click', () => {
      dismissTeaser();
      toggleWidget();
    });

    // ── Chat window ──
    const win = document.createElement('div');
    win.id = 'chatbot-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', `${name} chat`);

    const avatarHtml = profileImage
      ? `<div id="chatbot-avatar"><img src="${profileImage}" alt="${name}" loading="lazy"/></div>`
      : `<div id="chatbot-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></div>`;

    win.innerHTML = `
      <div id="chatbot-header">
        ${avatarHtml}
        <div id="chatbot-header-text">
          <div id="chatbot-title">${escapeHtml(name)}</div>
          <div id="chatbot-subtitle">Online · Typically replies instantly</div>
        </div>
        <button id="chatbot-close" aria-label="Close chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="chatbot-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>
      <div id="chatbot-starters"></div>
      <div id="chatbot-input-area">
        <textarea id="chatbot-input" placeholder="Type a message..." rows="1" aria-label="Message input"></textarea>
        <button id="chatbot-send" aria-label="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div id="chatbot-powered">Rai's Chatbots</div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(win);

    elements = {
      ...elements,
      launcher,
      win,
      messages: win.querySelector('#chatbot-messages'),
      starters: win.querySelector('#chatbot-starters'),
      input: win.querySelector('#chatbot-input'),
      send: win.querySelector('#chatbot-send'),
      close: win.querySelector('#chatbot-close'),
    };

    // Event listeners
    elements.close.addEventListener('click', toggleWidget);
    elements.send.addEventListener('click', sendMessage);
    elements.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    elements.input.addEventListener('input', autoResize);

    // Welcome message
    appendMessage('bot', welcomeMessage);

    // Starter prompts
    buildStarters();
  }

  function buildStarters() {
    const container = elements.starters;
    container.innerHTML = '';
    STARTER_PROMPTS.forEach((prompt) => {
      const btn = document.createElement('button');
      btn.className = 'cb-starter';
      btn.textContent = prompt;
      btn.addEventListener('click', () => {
        container.remove(); // Hide starters after first use
        triggerMessage(prompt);
      });
      container.appendChild(btn);
    });
  }

  function dismissTeaser() {
    if (teaserDismissed) return;
    teaserDismissed = true;
    if (elements.teaser) {
      elements.teaser.style.opacity = '0';
      elements.teaser.style.transform = 'translateY(6px)';
      elements.teaser.style.transition = 'opacity 0.2s, transform 0.2s';
      setTimeout(() => elements.teaser && elements.teaser.remove(), 200);
    }
  }

  // ─── Widget Toggle ─────────────────────────────────────────────────────────

  function toggleWidget() {
    isOpen = !isOpen;
    elements.win.classList.toggle('open', isOpen);
    elements.launcher.innerHTML = isOpen
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

    if (isOpen) {
      setTimeout(() => elements.input.focus(), 200);
      scrollToBottom();
    }
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  function appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `cb-msg ${role}`;
    msg.textContent = text;
    elements.messages.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function showTyping() {
    if (isTyping) return;
    isTyping = true;
    const el = document.createElement('div');
    el.id = 'chatbot-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    elements.messages.appendChild(el);
    scrollToBottom();
  }

  function hideTyping() {
    isTyping = false;
    const el = document.getElementById('chatbot-typing');
    if (el) el.remove();
  }

  function scrollToBottom() {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function setInputEnabled(enabled) {
    elements.input.disabled = !enabled;
    elements.send.disabled = !enabled;
  }

  // Send a message programmatically (used by starter prompts)
  function triggerMessage(text) {
    elements.input.value = text;
    sendMessage();
  }

  async function sendMessage() {
    const text = elements.input.value.trim();
    if (!text || isTyping) return;

    // Hide starters on first real send
    if (elements.starters && elements.starters.parentNode) {
      elements.starters.remove();
    }

    elements.input.value = '';
    autoResize();
    appendMessage('user', text);
    setInputEnabled(false);
    showTyping();

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatbotId: CHATBOT_ID, message: text, sessionId }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const newSession = response.headers.get('X-Session-Id');
      if (newSession) sessionId = newSession;

      hideTyping();
      const botMsg = appendMessage('bot', '');
      let fullText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            try {
              const payload = JSON.parse(raw);
              if (payload.content) {
                fullText += payload.content;
                botMsg.textContent = fullText;
                scrollToBottom();
              }
              if (payload.sessionId && !sessionId) {
                sessionId = payload.sessionId;
              }
            } catch { /* ignore */ }
          }
        }
      }

      if (!fullText) {
        botMsg.textContent = "I'm sorry, I couldn't generate a response.";
      }
    } catch (err) {
      hideTyping();
      appendMessage('error', `Error: ${err.message}`);
    } finally {
      setInputEnabled(true);
      setTimeout(() => elements.input.focus(), 100);
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function autoResize() {
    const input = elements.input;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function initWidget() {
    injectStyles(botConfig.primaryColor || '#0066cc');
    buildWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConfig);
  } else {
    loadConfig();
  }
})();
