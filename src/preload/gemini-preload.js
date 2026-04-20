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
const provider = 'gemini';

let inputElement = null;
let lastText = '';

function findGeminiInput(element) {
  if (!element) return null;

  if (element.tagName === 'RICH-TEXTAREA') {
    const contenteditable = element.querySelector('[contenteditable="true"]');
    if (contenteditable) return contenteditable;
  }

  if (element.contentEditable === 'true') {
    const paragraph = element.querySelector('p');
    if (paragraph) return paragraph;
    return element;
  }

  return element;
}

function injectText(text) {
  const rawElement = findElement(config.gemini?.input);
  inputElement = findGeminiInput(rawElement);

  if (!inputElement) {
    ipcRenderer.invoke('selector-error', 'gemini', 'Input element not found');
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
  } else if (inputElement.contentEditable === 'true' || inputElement.tagName === 'P') {
    // Gemini uses rich-textarea (Angular custom element) which maintains its own state.
    // Direct DOM manipulation doesn't update the component's model.
    // Use execCommand which triggers native input events that Angular listens to.
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
      console.error('[Gemini] execCommand injection failed, using fallback:', err);
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
  } else {
    inputElement.textContent = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const submitMessage = createSubmitHandler(
  provider,
  config,
  () => inputElement,
  null
);

setupIPCListeners(provider, config, injectText, submitMessage, { value: lastText });

setupInputScanner(
  provider,
  config,
  () => inputElement,
  (el) => { inputElement = el; },
  (selector) => findGeminiInput(findElement(selector))
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

// Debug function to inspect actual DOM structure for Gemini
window.polygptDebugGeminiDOM = function() {
  console.log('=== Gemini DOM Debug Info ===');
  console.log('URL:', window.location.href);

  const container = findElement(config.gemini?.responseContainer);
  console.log('Response container tag:', container?.tagName, 'id:', container?.id);

  if (container) {
    // Dump direct children of #chat-history — this reveals the real layout
    console.log('\n--- Direct children of response container ---');
    Array.from(container.children).forEach((el, idx) => {
      const text = (el.innerText || '').trim();
      console.log(`Child ${idx + 1}: <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + (typeof el.className === 'string' ? el.className : '').split(/\s+/).join('.') : ''}> (${text.length} chars) "${text.substring(0, 120)}"`);
    });

    // Look for any Angular custom elements (uppercase tags)
    console.log('\n--- Custom Angular elements inside container ---');
    const allEls = container.querySelectorAll('*');
    const customTags = new Set();
    Array.from(allEls).forEach(el => {
      if (el.tagName.includes('-') || /^[A-Z]+$/.test(el.tagName)) {
        customTags.add(el.tagName.toLowerCase());
      }
    });
    console.log('Custom tags found:', Array.from(customTags).join(', '));

    // Scan for ANY element containing substantial text that's not user input
    console.log('\n--- Elements with >100 chars text (potential responses) ---');
    const textEls = Array.from(container.querySelectorAll('*')).filter(el => {
      const text = (el.innerText || '').trim();
      return text.length > 100 && text.length < 10000 && el.children.length < 50;
    });
    textEls.slice(0, 10).forEach((el, idx) => {
      const classes = typeof el.className === 'string' ? el.className : '';
      console.log(`Element ${idx + 1}: <${el.tagName.toLowerCase()}.${classes.substring(0, 80)}> (${(el.innerText || '').length} chars)`);
      console.log(`   Preview: "${(el.innerText || '').substring(0, 150).replace(/\n/g, ' | ')}"`);
    });

    // Check for error/auth/signin messages on the page
    const bodyText = document.body.innerText || '';
    const warningPatterns = [
      /sign in/i,
      /unable to/i,
      /try again/i,
      /something went wrong/i,
      /rate limit/i,
      /not available/i,
      /can't help/i,
      /I can't/i,
    ];
    const warnings = warningPatterns.filter(p => p.test(bodyText));
    if (warnings.length > 0) {
      console.warn('⚠️ Potential error/auth text found on page matching:', warnings.map(w => w.toString()));
    }
  }
  console.log('=== End Gemini Debug Info ===');
};

// Auto-trigger debug dump after each submission so we can see what actually
// rendered when response detection fails. Runs once, 15s after submit.
ipcRenderer.on('submit-message', () => {
  setTimeout(() => {
    console.log('[DEBUG-TRIGGER] Running Gemini DOM inspection 15s after question submission...');
    try { window.polygptDebugGeminiDOM(); } catch (e) { console.error('Debug dump error:', e); }
  }, 15000);
});

// Detect server error pages (502, etc.) - retry is handled by main process
function isErrorPage() {
  const bodyText = document.body ? document.body.innerText : '';
  return /502\.\s*That's an error|503\.\s*That's an error|server encountered a temporary error/i.test(bodyText);
}

// Setup response monitoring
const responseMonitor = setupResponseMonitoring(provider, config, ipcRenderer, getViewInfo);
waitForDOM(() => {
  // Skip setup if page is a server error (main process will auto-retry)
  if (isErrorPage()) {
    console.log('[gemini] Server error page detected, waiting for main process auto-retry...');
    return;
  }

  const viewInfo = getViewInfo();
  if (viewInfo) createUIControls(viewInfo);
  // Start monitoring after a short delay to ensure page is loaded
  setTimeout(() => responseMonitor.startMonitoring(), 2000);
});

// Setup health check (runs 10 seconds after page load)
setupHealthCheck(provider, config, getViewInfo);
