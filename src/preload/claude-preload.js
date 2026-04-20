const { ipcRenderer } = require('electron');
const {
  loadConfig,
  findElement,
  createSubmitHandler,
  setupIPCListeners,
  setupInputScanner,
  createUIControls,
  setupViewInfoListener,
  setupSupersizeListener,
  setupLoadingOverlay,
  waitForDOM,
  setupResponseMonitoring,
  setupHealthCheck,
} = require('./shared-preload-utils');

const config = loadConfig();
const provider = 'claude';

let inputElement = null;
let lastText = '';
function injectText(text) {
  // Always rescan input element in case user switched chats
  inputElement = findElement(config.claude?.input);

  if (!inputElement) {
    ipcRenderer.invoke('selector-error', 'claude', 'Input element not found');
    return;
  }

  lastText = text;

  // Focus the element first - required for execCommand to work
  inputElement.focus();

  if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
    inputElement.value = text;
    inputElement.selectionStart = text.length;
    inputElement.selectionEnd = text.length;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (inputElement.contentEditable === 'true') {
    // Claude uses Tiptap/ProseMirror which maintains its own model.
    // Direct DOM manipulation doesn't update the editor state.
    // Use execCommand which triggers the native input path that ProseMirror listens to.
    try {
      // Select all existing content
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputElement);
      sel.removeAllRanges();
      sel.addRange(range);

      // Delete existing content
      document.execCommand('delete', false, null);

      // Insert new text
      if (text.length > 0) {
        document.execCommand('insertText', false, text);
      }
    } catch (err) {
      console.error('[Claude] execCommand injection failed, using fallback:', err);
      // Fallback: direct DOM manipulation + events
      while (inputElement.firstChild) {
        inputElement.removeChild(inputElement.firstChild);
      }
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        inputElement.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
          inputElement.appendChild(document.createElement('br'));
        }
      });
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

// Custom submit handler for Claude - finds submit button by DOM proximity to input
function claudeSubmitMessage() {
  // First try standard selectors
  const submitElement = findElement(config.claude?.submit);
  if (submitElement) {
    submitElement.click();
    return;
  }

  // Fallback: find send button near the input by walking up the DOM
  const input = findElement(config.claude?.input);
  if (input) {
    let container = input.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      // Look for button with send-related attributes or SVG icon buttons
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        const text = (btn.innerText || '').trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        // Match send button: icon-only buttons near input, or buttons with send-like aria-labels
        if (ariaLabel.includes('send') || ariaLabel.includes('submit')) {
          console.log('[Claude] Found send button via aria-label:', ariaLabel);
          btn.click();
          return;
        }
        // Icon-only button (no text, has SVG child) near the input area
        if (!text && btn.querySelector('svg') && !btn.closest('nav') && !btn.closest('header')) {
          console.log('[Claude] Found send button via DOM navigation (icon-only button)');
          btn.click();
          return;
        }
      }
      container = container.parentElement;
    }

    // Fallback: dispatch Enter key to the input
    console.log('[Claude] Submit button not found, using Enter key fallback');
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enterEvent);
  }
}

setupIPCListeners(provider, config, injectText, claudeSubmitMessage, { value: lastText });

setupInputScanner(
  provider,
  config,
  () => inputElement,
  (el) => { inputElement = el; },
  null
);

const getMergerWindow = async () => {
  const settings = await ipcRenderer.invoke('get-merge-settings');
  return settings?.mergerWindow || 'bottomRight';
};

const getViewInfo = setupViewInfoListener((viewInfo) => {
  window.polygptGetViewInfo = () => viewInfo;
  createUIControls(viewInfo);
}, getMergerWindow);

setupSupersizeListener();

setupLoadingOverlay();

// Debug function to inspect actual DOM structure
window.polygptDebugClaudeDOM = function() {
  console.log('=== Claude DOM Debug Info ===');
  console.log('URL:', window.location.href);
  console.log('Title:', document.title);

  const container = findElement(config.claude?.responseContainer);
  console.log('Response container:', container?.tagName || 'NOT FOUND');

  // Check input
  const input = findElement(config.claude?.input);
  console.log('Input element:', input ? `${input.tagName}.${input.className?.substring(0, 50)}` : 'NOT FOUND');

  // Check for response elements
  if (container) {
    const proseElements = container.querySelectorAll('[class*="prose"], [class*="markdown"]');
    console.log(`Prose/markdown elements: ${proseElements.length}`);

    const textElements = Array.from(container.querySelectorAll('*')).filter(el => {
      const text = el.innerText || el.textContent || '';
      if (text.includes('{') && text.includes('}')) {
        const cssChars = (text.match(/[{}:;]/g) || []).length;
        if (cssChars > text.length * 0.1) return false;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return text.length > 100 && !el.querySelector('input, textarea') && text.trim().length > 50;
    });
    console.log(`Elements with substantial text: ${textElements.length}`);
  }
  console.log('=== End Debug Info ===');
};

// Log key state after page loads
setTimeout(() => {
  console.log('[CLAUDE] URL:', window.location.href);
  console.log('[CLAUDE] Input found:', !!findElement(config.claude?.input));
  console.log('[CLAUDE] Main found:', !!document.querySelector('main'));
  console.log('[CLAUDE] #root children:', document.querySelector('#root')?.children?.length || 0);
}, 5000);

// Setup response monitoring
const responseMonitor = setupResponseMonitoring(provider, config, ipcRenderer, getViewInfo);
waitForDOM(() => {
  const viewInfo = getViewInfo();
  if (viewInfo) createUIControls(viewInfo);
  // Start monitoring after a short delay to ensure page is loaded
  setTimeout(() => responseMonitor.startMonitoring(), 2000);
});

// Setup health check (runs 10 seconds after page load)
setupHealthCheck(provider, config, getViewInfo);
