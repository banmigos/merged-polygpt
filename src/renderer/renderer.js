const { ipcRenderer } = require('electron');
const throttle = require('../utils/throttle');

const textInput = document.getElementById('textInput');
const charCount = document.getElementById('charCount');
const responseStatus = document.getElementById('responseStatus');
const refreshBtn = document.getElementById('refreshBtn');
const newChatBtn = document.getElementById('newChatBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const mergeModeToggle = document.getElementById('mergeModeToggle');
const autoMergeToggle = document.getElementById('autoMergeToggle');
const mergerWindowSelect = document.getElementById('mergerWindowSelect');
const timeoutSelect = document.getElementById('timeoutSelect');
const mergeNowBtn = document.getElementById('mergeNowBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

let currentText = '';
let responseCount = 0;
let submitTime = null;
let timerInterval = null;
let isDarkMode = false;

function updateCharCount() {
  charCount.textContent = textInput.value.length;
}

const sendTextUpdate = throttle(async (text) => {
  currentText = text;
  await ipcRenderer.invoke('send-text-update', text);
}, 50);

textInput.addEventListener('input', (event) => {
  updateCharCount();
  sendTextUpdate(event.target.value);
});

textInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitMessage();
  }
});

function updateElapsedTime() {
  if (!submitTime) return;

  const elapsed = Math.floor((Date.now() - submitTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  responseStatus.textContent = `${responseCount}/3 responses (${timeStr})`;
}

function submitMessage() {
  if (currentText.trim() === '') {
    return;
  }

  // Start timer
  submitTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateElapsedTime, 1000);
  updateElapsedTime();

  ipcRenderer.invoke('submit-message').catch((error) => {
    console.error('Failed to submit:', error);
  });

  textInput.value = '';
  currentText = '';
  updateCharCount();
}

refreshBtn.addEventListener('click', () => {
  ipcRenderer.invoke('refresh-pages').catch((error) => {
    console.error('Failed to refresh:', error);
  });
});

newChatBtn.addEventListener('click', () => {
  ipcRenderer.invoke('new-chat').catch((error) => {
    console.error('Failed to start new chat:', error);
  });

  textInput.value = '';
  currentText = '';
  updateCharCount();
});

zoomInBtn.addEventListener('click', () => {
  ipcRenderer.invoke('zoom-in').catch((error) => {
    console.error('Failed to zoom in:', error);
  });
});

zoomOutBtn.addEventListener('click', () => {
  ipcRenderer.invoke('zoom-out').catch((error) => {
    console.error('Failed to zoom out:', error);
  });
});

// Merge mode controls
mergeModeToggle.addEventListener('change', async () => {
  const isEnabled = mergeModeToggle.checked;
  await ipcRenderer.invoke('set-merge-mode', isEnabled);
  console.log('Merge mode:', isEnabled ? 'ON' : 'OFF');
});

autoMergeToggle.addEventListener('change', async () => {
  const isEnabled = autoMergeToggle.checked;
  await ipcRenderer.invoke('set-auto-merge', isEnabled);
  console.log('Auto-merge:', isEnabled ? 'ON' : 'OFF');
});

mergerWindowSelect.addEventListener('change', async () => {
  const position = mergerWindowSelect.value;
  await ipcRenderer.invoke('set-merger-window', position);
  console.log('Merger window:', position);
});

timeoutSelect.addEventListener('change', async () => {
  const timeout = parseInt(timeoutSelect.value);
  await ipcRenderer.invoke('set-merge-timeout', timeout);
  console.log('Merge timeout:', timeout === -1 ? 'infinite' : `${timeout}s`);
});

mergeNowBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('merge-now');
  console.log('Manual merge triggered');
});

// Theme toggle
themeToggleBtn.addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark-mode', isDarkMode);
  themeToggleBtn.textContent = isDarkMode ? '☀️ Light' : '🌙 Dark';
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
});

// Listen for response status updates
ipcRenderer.on('response-status-update', (event, data) => {
  responseCount = data.count;
  const total = data.total || 3;

  if (data.mergeComplete) {
    // Merge finished
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    const elapsed = submitTime ? Math.floor((Date.now() - submitTime) / 1000) : 0;
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    responseStatus.textContent = `✓ Merge complete (${timeStr})`;
    submitTime = null;
  } else if (data.merging) {
    // Merge in progress - keep timer running
    if (submitTime) {
      updateElapsedTime();
      responseStatus.textContent = responseStatus.textContent.replace(/\)$/, ') — merging...');
    } else {
      responseStatus.textContent = '3/3 responses — merging...';
    }
  } else {
    // Normal response counting
    if (submitTime) {
      updateElapsedTime();
    } else {
      responseStatus.textContent = `${responseCount}/${total} responses received`;
    }

    // Stop timer when all responses received (only in non-merge mode)
    if (responseCount >= total) {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }
  }
});

// Listen for merge-ready event (manual merge mode)
ipcRenderer.on('merge-ready', () => {
  // Highlight the merge now button
  mergeNowBtn.classList.add('merge-ready');
  mergeNowBtn.textContent = '✨ Ready to Merge!';

  // Reset after user clicks
  const resetButton = () => {
    mergeNowBtn.classList.remove('merge-ready');
    mergeNowBtn.textContent = '⚡ Merge Now';
  };

  // Auto-reset on next click
  mergeNowBtn.addEventListener('click', resetButton, { once: true });
});

// Load saved settings on startup
async function loadSettings() {
  try {
    const settings = await ipcRenderer.invoke('get-merge-settings');
    if (settings) {
      mergeModeToggle.checked = settings.mergeModeEnabled || false;
      autoMergeToggle.checked = settings.autoMerge !== undefined ? settings.autoMerge : true;
      mergerWindowSelect.value = settings.mergerWindow || 'bottomRight';
      timeoutSelect.value = settings.mergeTimeout !== undefined ? settings.mergeTimeout : 300;
    }

    // Load theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      isDarkMode = true;
      document.body.classList.add('dark-mode');
      themeToggleBtn.textContent = '☀️ Light';
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

textInput.focus();

updateCharCount();
loadSettings();
