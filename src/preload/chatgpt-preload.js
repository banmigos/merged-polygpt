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
const provider = 'chatgpt';

let inputElement = null;
let lastText = '';

function injectText(text) {
  inputElement = findElement(config.chatgpt?.input);

  if (!inputElement) {
    ipcRenderer.invoke('selector-error', 'chatgpt', 'Input element not found');
    return;
  }

  lastText = text;

  // Focus the element first
  inputElement.focus();

  if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
    inputElement.value = text;
    inputElement.selectionStart = text.length;
    inputElement.selectionEnd = text.length;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (inputElement.contentEditable === 'true') {
    // ChatGPT uses a React-controlled contentEditable.
    // Use execCommand to trigger native input events that React listens to.
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputElement);
      sel.removeAllRanges();
      sel.addRange(range);

      document.execCommand('delete', false, null);

      if (text.length > 0) {
        document.execCommand('insertText', false, text);
      }
    } catch (err) {
      console.error('[ChatGPT] execCommand injection failed, using fallback:', err);
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
