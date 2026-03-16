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

  // Handle textarea
  if (inputElement.tagName === 'TEXTAREA') {
    inputElement.value = text;
    // Set selection to end of text
    inputElement.selectionStart = text.length;
    inputElement.selectionEnd = text.length;
  } else if (inputElement.contentEditable === 'true') {
    // Handle contenteditable div - preserve newlines as <br>
    // Clear existing content - avoid innerHTML due to TrustedHTML CSP
    while (inputElement.firstChild) {
      inputElement.removeChild(inputElement.firstChild);
    }

    // Split by newlines and create text nodes with <br> between them
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      inputElement.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) {
        inputElement.appendChild(document.createElement('br'));
      }
    });
  } else if (inputElement.tagName === 'INPUT') {
    inputElement.value = text;
  }

  // Dispatch events to trigger React/framework detection
  const events = [
    new Event('input', { bubbles: true }),
    new Event('change', { bubbles: true }),
    new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key: 'a',
    }),
  ];

  events.forEach((event) => inputElement.dispatchEvent(event));
}

// Custom submit handler for Claude - finds submit button by DOM proximity to input
function claudeSubmitMessage() {
  // First try standard selectors
  const submitElement = findElement(config.claude?.submit);
  if (submitElement) {
    submitElement.click();
    return;
  }

  // Claude's send button has no aria-label or data-testid, and no explicit type attribute.
  // Find it by walking up from the input element to find the nearby send button.
  const input = findElement(config.claude?.input);
  if (input) {
    // Walk up to find a container with the send button (fieldset or form-like wrapper)
    let container = input.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      // Look for a button without text content (icon-only send button)
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        const text = (btn.innerText || '').trim();
        const ariaLabel = btn.getAttribute('aria-label') || '';
        // The send button is icon-only (no text), not a labeled UI button
        if (!text && !ariaLabel && !btn.getAttribute('data-testid')) {
          // Likely the send button - it's an icon-only button near the input
          console.log('[Claude] Found send button via DOM navigation');
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
