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

  if (inputElement.tagName === 'TEXTAREA') {
    inputElement.value = text;
    inputElement.selectionStart = text.length;
    inputElement.selectionEnd = text.length;
  } else if (inputElement.contentEditable === 'true' || inputElement.tagName === 'P') {
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
  } else if (inputElement.tagName === 'INPUT') {
    inputElement.value = text;
  } else {
    inputElement.textContent = text;
  }

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
  const container = findElement(config.gemini?.responseContainer);
  console.log('Response container:', container);

  if (container) {
    console.log('\n--- Custom elements (model-response, message-content) ---');
    const customEls = container.querySelectorAll('model-response, message-content');
    console.log(`Found ${customEls.length} custom elements`);
    Array.from(customEls).forEach((el, idx) => {
      console.log(`Element ${idx + 1}:`, {
        tag: el.tagName,
        attributes: Array.from(el.attributes).map(a => `${a.name}="${a.value}"`),
        textPreview: (el.innerText || '').substring(0, 150)
      });
    });

    console.log('\n--- Divs with "model" or "response" in class ---');
    const responseEls = container.querySelectorAll('[class*="model"], [class*="response"]');
    console.log(`Found ${responseEls.length} elements`);
    Array.from(responseEls).slice(0, 10).forEach((el, idx) => {
      const text = el.innerText || '';
      if (text.length > 50) {
        console.log(`Element ${idx + 1}:`, {
          tag: el.tagName,
          classes: el.className,
          textLength: text.length,
          textPreview: text.substring(0, 150)
        });
      }
    });
  }
  console.log('=== End Gemini Debug Info ===');
};

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

