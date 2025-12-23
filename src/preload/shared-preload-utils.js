const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

function loadConfig() {
  try {
    const configPath = path.join(__dirname, '../../config/selectors.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Failed to load selectors config:', error);
    return {};
  }
}

function findElement(selectors, debug = false) {
  if (!Array.isArray(selectors)) {
    selectors = [selectors];
  }

  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        if (debug) {
          console.log(`[DEBUG] Found element with selector: ${selector}`);
        }
        return element;
      }
    } catch (error) {
      continue;
    }
  }

  if (debug) {
    console.log(`[DEBUG] No element found. Tried selectors:`, selectors);
  }
  return null;
}

function createSubmitHandler(provider, config, getInputElement, getSubmitElement) {
  return function submitMessage() {
    const submitElement = findElement(config[provider]?.submit);

    if (submitElement) {
      submitElement.click();
    } else {
      const inputElement = getInputElement();
      if (inputElement) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        });
        inputElement.dispatchEvent(enterEvent);
      }
    }
  };
}

function setupIPCListeners(provider, config, injectTextFn, submitFn, lastText) {
  ipcRenderer.on('text-update', (event, text) => {
    if (text !== lastText.value) {
      injectTextFn(text);
    }
  });

  ipcRenderer.on('submit-message', () => {
    submitFn();
  });

  ipcRenderer.on('new-chat', () => {
    const newChatButton = findElement(config[provider]?.newChat);
    if (newChatButton) {
      newChatButton.click();
    } else {
      console.warn(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}] New chat button not found`);
    }
  });
}

function setupInputScanner(provider, config, getInputElement, setInputElement, findInputFn) {
  let scanAttempts = 0;
  const scanInterval = setInterval(() => {
    if (!getInputElement() && scanAttempts < 10) {
      const element = findInputFn ? findInputFn(config[provider]?.input) : findElement(config[provider]?.input);
      setInputElement(element);
      scanAttempts++;
    } else {
      clearInterval(scanInterval);
    }
  }, 500);
}

function removeExistingControls() {
  const existingContainer = document.getElementById('polygpt-controls-container');
  if (existingContainer) {
    existingContainer.remove();
  }
}

function createControlsContainer() {
  const container = document.createElement('div');
  container.id = 'polygpt-controls-container';
  Object.assign(container.style, {
    all: 'initial',
    position: 'fixed',
    top: '10px',
    right: '10px',
    display: 'flex',
    gap: '8px',
    zIndex: '9999999',
    pointerEvents: 'auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '14px',
    fontWeight: 'normal',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    boxSizing: 'border-box',
    margin: '0',
  });
  return container;
}

function createProviderDropdown() {
  const dropdownContainer = document.createElement('div');
  dropdownContainer.id = 'polygpt-provider-dropdown';
  dropdownContainer.title = 'Switch Provider';

  const selected = document.createElement('div');
  selected.className = 'dropdown-selected';

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu.style.display = 'none';

  dropdownContainer.appendChild(selected);
  dropdownContainer.appendChild(menu);

  return dropdownContainer;
}

function styleDropdown(dropdown) {
  const selected = dropdown.querySelector('.dropdown-selected');
  const menu = dropdown.querySelector('.dropdown-menu');

  Object.assign(dropdown.style, {
    position: 'relative',
    cursor: 'pointer',
    boxSizing: 'border-box',
    margin: '0',
  });

  Object.assign(selected.style, {
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.5)',
    color: 'white',
    fontSize: '14px',
    fontFamily: 'inherit',
    fontWeight: 'normal',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    padding: '8px 12px',
    height: '36px',
    minWidth: '100px',
    backdropFilter: 'blur(4px)',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    boxSizing: 'border-box',
    margin: '0',
  });

  Object.assign(menu.style, {
    position: 'absolute',
    top: '40px',
    left: '0',
    width: '100%',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.9)',
    backdropFilter: 'blur(4px)',
    zIndex: '10000000',
    overflow: 'hidden',
    boxSizing: 'border-box',
    margin: '0',
    padding: '0',
  });
}

function populateDropdownOptions(dropdown, viewInfo) {
  const selected = dropdown.querySelector('.dropdown-selected');
  const menu = dropdown.querySelector('.dropdown-menu');

  const currentProvider = viewInfo.availableProviders.find(p => p.key === viewInfo.provider);
  selected.textContent = currentProvider ? currentProvider.name : '';

  viewInfo.availableProviders.forEach(provider => {
    const option = document.createElement('div');
    option.className = 'dropdown-option';
    option.dataset.value = provider.key;
    option.textContent = provider.name;

    Object.assign(option.style, {
      padding: '10px 12px',
      color: 'white',
      fontSize: '14px',
      fontFamily: 'inherit',
      fontWeight: 'normal',
      lineHeight: 'normal',
      letterSpacing: 'normal',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      background: provider.key === viewInfo.provider ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
      boxSizing: 'border-box',
      margin: '0',
      border: 'none',
    });

    option.addEventListener('mouseenter', () => {
      option.style.background = 'rgba(255, 255, 255, 0.2)';
    });

    option.addEventListener('mouseleave', () => {
      option.style.background = provider.key === viewInfo.provider ? 'rgba(255, 255, 255, 0.1)' : 'transparent';
    });

    menu.appendChild(option);
  });
}

function attachDropdownEventListeners(dropdown, viewInfo) {
  const selected = dropdown.querySelector('.dropdown-selected');
  const menu = dropdown.querySelector('.dropdown-menu');

  let hideTimeout;

  const showMenu = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    selected.style.background = 'rgba(0, 0, 0, 0.7)';
    menu.style.display = 'block';
  };

  const hideMenu = () => {
    hideTimeout = setTimeout(() => {
      selected.style.background = 'rgba(0, 0, 0, 0.5)';
      menu.style.display = 'none';
    }, 100);
  };

  dropdown.addEventListener('mouseenter', showMenu);
  dropdown.addEventListener('mouseleave', hideMenu);
  menu.addEventListener('mouseenter', showMenu);
  menu.addEventListener('mouseleave', hideMenu);

  menu.addEventListener('click', async (e) => {
    if (e.target.classList.contains('dropdown-option')) {
      const newProvider = e.target.dataset.value;
      selected.textContent = e.target.textContent;
      await ipcRenderer.invoke('change-provider', viewInfo.position, newProvider);
      if (hideTimeout) clearTimeout(hideTimeout);
      selected.style.background = 'rgba(0, 0, 0, 0.5)';
      menu.style.display = 'none';
    }
  });
}

function createSupersizeButton() {
  const button = document.createElement('button');
  button.id = 'polygpt-supersize-btn';
  button.title = 'Supersize / Restore';
  return button;
}

function styleButton(button) {
  Object.assign(button.style, {
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.5)',
    color: 'white',
    width: '36px',
    height: '36px',
    minWidth: '36px',
    minHeight: '36px',
    maxWidth: '36px',
    maxHeight: '36px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
    transition: 'all 0.2s ease',
    padding: '0',
    margin: '0',
    fontSize: '16px',
    fontFamily: 'inherit',
    fontWeight: 'normal',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    boxSizing: 'border-box',
  });
}

function createButtonIcons(button) {
  const expandIcon = document.createElement('span');
  expandIcon.className = 'icon-expand';
  expandIcon.textContent = '⛶';
  expandIcon.style.display = 'block';

  const collapseIcon = document.createElement('span');
  collapseIcon.className = 'icon-collapse';
  collapseIcon.textContent = '◱';
  collapseIcon.style.display = 'none';

  button.appendChild(expandIcon);
  button.appendChild(collapseIcon);
}

function attachButtonEventListeners(button, viewInfo) {
  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(0, 0, 0, 0.7)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = 'rgba(0, 0, 0, 0.5)';
  });

  button.addEventListener('mousedown', () => {
    button.style.transform = 'scale(0.95)';
  });

  button.addEventListener('mouseup', () => {
    button.style.transform = 'scale(1)';
  });

  button.addEventListener('click', async () => {
    await ipcRenderer.invoke('toggle-supersize', viewInfo.position);
  });
}

function createUIControls(viewInfo) {
  removeExistingControls();

  const container = createControlsContainer();

  const dropdown = createProviderDropdown();
  styleDropdown(dropdown);
  populateDropdownOptions(dropdown, viewInfo);
  attachDropdownEventListeners(dropdown, viewInfo);

  const button = createSupersizeButton();
  styleButton(button);
  createButtonIcons(button);
  attachButtonEventListeners(button, viewInfo);

  container.appendChild(dropdown);
  container.appendChild(button);
  document.body.appendChild(container);
}

function setupViewInfoListener(createUIControlsFn, getMergerWindow) {
  let viewInfo = null;

  ipcRenderer.on('view-info', (event, info) => {
    viewInfo = info;
    if (document.body) {
      createUIControlsFn(info);

      // Get merger window and show indicator if needed
      if (getMergerWindow) {
        getMergerWindow().then(mergerWindow => {
          updateMergerIndicator(viewInfo, mergerWindow);
        });
      }
    }
  });

  // Listen for merger window updates
  ipcRenderer.on('merger-window-changed', (event, mergerPosition) => {
    updateMergerIndicator(viewInfo, mergerPosition);
  });

  return () => viewInfo;
}

function updateMergerIndicator(viewInfo, mergerPosition) {
  if (!viewInfo) return;

  // Remove existing indicator
  const existingIndicator = document.getElementById('polygpt-merger-indicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }

  // Add indicator if this is the merger window
  if (viewInfo.position === mergerPosition) {
    const indicator = document.createElement('div');
    indicator.id = 'polygpt-merger-indicator';
    Object.assign(indicator.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      border: '4px solid #ff6b35',
      borderRadius: '8px',
      pointerEvents: 'none',
      zIndex: '9999998',
      boxShadow: 'inset 0 0 20px rgba(255, 107, 53, 0.3)',
      animation: 'polygpt-pulse 2s ease-in-out infinite'
    });

    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes polygpt-pulse {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; }
      }
    `;
    if (!document.querySelector('#polygpt-merger-style')) {
      style.id = 'polygpt-merger-style';
      document.head.appendChild(style);
    }

    document.body.appendChild(indicator);

    // Add label
    const label = document.createElement('div');
    label.textContent = '🔀 MERGER WINDOW';
    Object.assign(label.style, {
      position: 'fixed',
      top: '50px',
      right: '50px',
      background: 'rgba(255, 107, 53, 0.9)',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 'bold',
      zIndex: '9999999',
      pointerEvents: 'none',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
    });
    document.body.appendChild(label);
  }
}

function setupSupersizeListener() {
  ipcRenderer.on('supersize-state-changed', (event, supersizedPosition) => {
    const button = document.getElementById('polygpt-supersize-btn');
    const viewInfoGetter = window.polygptGetViewInfo;

    if (!button || !viewInfoGetter) return;

    const viewInfo = viewInfoGetter();
    if (!viewInfo) return;

    const expandIcon = button.querySelector('.icon-expand');
    const collapseIcon = button.querySelector('.icon-collapse');

    if (supersizedPosition === viewInfo.position) {
      expandIcon.style.display = 'none';
      collapseIcon.style.display = 'block';
    } else {
      expandIcon.style.display = 'block';
      collapseIcon.style.display = 'none';
    }
  });
}

function createLoadingOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'polygpt-loading-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    background: 'rgba(255, 255, 255, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999999',
    backdropFilter: 'blur(4px)',
  });

  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width: '50px',
    height: '50px',
    border: '4px solid rgba(0, 0, 0, 0.1)',
    borderTop: '4px solid rgba(0, 0, 0, 0.6)',
    borderRadius: '50%',
    animation: 'polygpt-spin 1s linear infinite',
  });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes polygpt-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  overlay.appendChild(spinner);
  document.body.appendChild(overlay);

  return overlay;
}

function setupLoadingOverlay() {
  let loadingOverlay = null;
  if (document.body) {
    loadingOverlay = createLoadingOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      loadingOverlay = createLoadingOverlay();
    });
  }

  window.addEventListener('load', () => {
    if (loadingOverlay) {
      loadingOverlay.style.opacity = '0';
      loadingOverlay.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        if (loadingOverlay && loadingOverlay.parentNode) {
          loadingOverlay.parentNode.removeChild(loadingOverlay);
        }
        loadingOverlay = null;
      }, 300);
    }
  });
}

function waitForDOM(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback);
  } else {
    callback();
  }
}

function extractLatestResponse(provider, config) {
  const responseSelectors = config[provider]?.response;
  if (!responseSelectors) {
    console.warn(`[${provider}] No response selectors configured`);
    return null;
  }

  // Find all response elements
  let allResponses = [];
  let workingSelector = null;
  for (const selector of responseSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        allResponses.push(...Array.from(elements));
        workingSelector = selector;
        break; // Use first working selector
      }
    } catch (error) {
      console.warn(`[${provider}] Selector error: ${selector}`, error);
      continue;
    }
  }

  // ROBUST FALLBACK: Auto-discover response elements if configured selectors fail
  if (allResponses.length === 0) {
    const container = findElement(config[provider]?.responseContainer) || document.body;

    // Try to find elements with substantial text content (likely responses)
    const candidates = Array.from(container.querySelectorAll('div, p, article, section')).filter(el => {
      const text = el.innerText || el.textContent || '';

      // Exclude elements that are:
      // - Too short (<50 chars)
      // - Input containers
      // - Inside contenteditable
      // - Hidden (display: none or visibility: hidden)
      // - Style/script/noscript tags
      // - Intercom widgets
      // - CSS content (has { } and no spaces between or very few words)
      if (text.length < 50) return false;
      if (el.querySelector('input, textarea')) return false;
      if (el.closest('[contenteditable="true"]')) return false;
      if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT' || el.tagName === 'NOSCRIPT') return false;

      // Exclude Intercom widget and similar UI elements
      const className = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
      if (className.includes('intercom-') || className.includes('widget-') || className.includes('launcher-')) return false;

      // Check if element is visible
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      // Exclude CSS-like content (contains { } and has low word count)
      if (text.includes('{') && text.includes('}')) {
        const words = text.split(/\s+/).filter(w => w.length > 2);
        const cssChars = (text.match(/[{}:;]/g) || []).length;
        // If >20% of content is CSS characters, it's probably CSS
        if (cssChars > text.length * 0.1 || words.length < 10) return false;
      }

      // Exclude elements with very low word density (like long strings without spaces)
      const words = text.trim().split(/\s+/);
      const avgWordLength = text.length / words.length;
      if (avgWordLength > 20) return false; // Likely code/CSS, not prose

      return true;
    });

    if (candidates.length > 0) {
      // Sort by text length (descending) - longer texts are more likely to be responses
      candidates.sort((a, b) => {
        const aLen = (a.innerText || '').length;
        const bLen = (b.innerText || '').length;
        return bLen - aLen;
      });

      // Take top candidates (up to 10) and add to responses
      allResponses.push(...candidates.slice(0, 10));
      workingSelector = '[auto-discovered]';
      console.log(`[${provider}] Auto-discovered ${allResponses.length} response elements`);

      // Log details of top 3 candidates to help identify proper selectors
      // Only log once per 60 seconds to avoid spam
      const now = Date.now();
      const shouldLog = !extractLatestResponse.lastSelectorLog || (now - extractLatestResponse.lastSelectorLog) > 60000;
      if (candidates.length > 0 && shouldLog) {
        extractLatestResponse.lastSelectorLog = now;
        console.log(`[${provider}] 💡 Selector suggestions (top 3 candidates):`);
        candidates.slice(0, 3).forEach((el, idx) => {
          // Handle className safely (could be string or SVGAnimatedString for SVG elements)
          const className = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
          const classes = className ? `.${className.split(/\s+/).filter(c => c).join('.')}` : '';
          const id = el.id ? `#${el.id}` : '';
          const tag = el.tagName.toLowerCase();
          const attrs = Array.from(el.attributes)
            .filter(a => a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-label')
            .map(a => `[${a.name}="${a.value}"]`)
            .join('');
          console.log(`   ${idx + 1}. ${tag}${id}${classes.substring(0, 50)}${attrs}`);
        });
      }
    }
  }

  if (allResponses.length === 0) {
    // Log every 10 seconds to avoid spam
    if (!extractLatestResponse.lastLogTime || Date.now() - extractLatestResponse.lastLogTime > 10000) {
      console.warn(`[${provider}] No response elements found. Tried selectors:`, responseSelectors);
      extractLatestResponse.lastLogTime = Date.now();
    }
    return null;
  }

  // Filter out thinking containers (Claude-specific)
  // Thinking containers are hidden (opacity: 0, height: 0, pointer-events-none)
  if (provider === 'claude') {
    const beforeCount = allResponses.length;

    allResponses = allResponses.filter(el => {
      // Check if element or any parent is hidden
      let current = el;
      while (current && current !== document.body) {
        // Check inline styles first (fast)
        const inlineStyle = current.getAttribute('style') || '';
        if (inlineStyle.includes('opacity: 0') ||
            inlineStyle.includes('height: 0') ||
            inlineStyle.includes('height:0')) {
          console.log(`[${provider}] Filtered out hidden element (inline style):`, (el.innerText || '').substring(0, 100));
          return false;
        }

        // Check for pointer-events-none class
        const classes = typeof current.className === 'string' ? current.className : '';
        if (classes.includes('pointer-events-none')) {
          console.log(`[${provider}] Filtered out pointer-events-none element:`, (el.innerText || '').substring(0, 100));
          return false;
        }

        // Check computed styles as backup (slower but more reliable)
        try {
          const computedStyle = window.getComputedStyle(current);
          const opacity = parseFloat(computedStyle.opacity);
          const height = computedStyle.height;
          const display = computedStyle.display;

          if (opacity === 0 || height === '0px' || display === 'none') {
            console.log(`[${provider}] Filtered out hidden element (computed style):`, (el.innerText || '').substring(0, 100));
            return false;
          }
        } catch (e) {
          // Style check failed, continue
        }

        current = current.parentElement;
      }
      return true;
    });

    console.log(`[${provider}] Filtered responses: ${beforeCount} -> ${allResponses.length} (using visibility filter)`);
    if (allResponses.length === 0) {
      console.warn(`[${provider}] All responses were filtered out as thinking tokens`);
      return null;
    }
  }

  // Get the last (most recent) response
  const lastResponse = allResponses[allResponses.length - 1];

  let text = lastResponse.innerText || lastResponse.textContent || '';

  // Debug logging for Claude
  if (provider === 'claude') {
    console.log(`[${provider}] Selected response element:`, {
      tag: lastResponse.tagName,
      classes: (lastResponse.className || '').substring(0, 150),
      textLength: text.length,
      textPreview: text.substring(0, 150)
    });
  }

  // Filter out common thinking/loading indicators
  const thinkingIndicators = [
    /^Thinking\s*$/i,
    /^Show thinking\s*$/i,
    /^Answer now\s*$/i,
    /^Examining.*\.\.\.$/i,
    /^Exploring.*\.\.\.$/i,
    /^Analyzing.*\.\.\.$/i,
    /^Processing.*\.\.\.$/i,
    /^Considering.*\.\.\.$/i,
    /^Revising.*\.\.\.$/i,
    /^Incorporating.*\.\.\.$/i,
    /^Prioritizing.*\.\.\.$/i,
    /^Acknowledging.*\.\.\.$/i,
    /^Requesting.*\.\.\.$/i,
    /^Defining.*\.\.\.$/i,
    /^You stopped this response\.\.\.$/i
  ];

  // Split by newlines and filter out lines that match thinking indicators
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return !thinkingIndicators.some(pattern => pattern.test(trimmed));
  });

  text = filteredLines.join('\n').trim();

  return {
    text: text,
    html: lastResponse.innerHTML || '',
    timestamp: Date.now(),
    selector: workingSelector
  };
}

function setupResponseMonitoring(provider, config, ipcRenderer, getViewInfo) {
  let lastResponseText = '';
  let responseObserver = null;
  let stopButtonObserver = null;
  let isMonitoring = false;
  let hasCompletedThisCycle = false;
  let isStreaming = false;
  const MAX_WAIT_TIME = 30000; // Force completion after 30 seconds even if still updating
  let maxWaitTimeout = null;
  let retryCompletionInterval = null; // For retrying after max wait timeout

  // Expose debug function globally
  window.polygptDebugStopButton = function() {
    console.log('=== Stop Button Debug Info ===');
    console.log('Provider:', provider);
    console.log('Configured selectors:', config[provider]?.stopButton);

    const selectors = config[provider]?.stopButton || [];
    selectors.forEach((selector, idx) => {
      try {
        const elements = document.querySelectorAll(selector);
        console.log(`Selector ${idx + 1}: "${selector}"`);
        console.log(`  Found ${elements.length} element(s)`);
        if (elements.length > 0) {
          console.log('  First element:', elements[0]);
          console.log('  HTML:', elements[0].outerHTML);
        }
      } catch (error) {
        console.log(`Selector ${idx + 1}: "${selector}" - ERROR:`, error.message);
      }
    });

    console.log('Currently streaming:', isStreaming);
    console.log('Current stop button found:', findElement(config[provider]?.stopButton) ? 'YES' : 'NO');
    console.log('=== End Debug Info ===');
  };

  function sendCompletion() {
    if (hasCompletedThisCycle) return;

    const viewInfo = getViewInfo ? getViewInfo() : null;
    const position = viewInfo ? viewInfo.position : null;

    // CRITICAL: Don't complete if stop button is still present (still streaming)
    const stopButton = findElement(config[provider]?.stopButton);
    if (stopButton && isStreaming) {
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] ⚠️ Stop button still present, not completing yet`);
      return;
    }

    const finalResponse = extractLatestResponse(provider, config);

    // Validate response exists
    if (!finalResponse || !finalResponse.text) {
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] No valid response found`);
      return;
    }

    const text = finalResponse.text.trim();

    // Only validate that response is not empty
    if (text.length === 0) {
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] Response is empty, skipping`);
      return;
    }

    // Send completion
    hasCompletedThisCycle = true;
    isStreaming = false;
    console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] Response complete (${text.length} chars)`);
    ipcRenderer.send('response-complete', {
      provider: provider,
      position: position,
      response: finalResponse,
      isComplete: true
    });

    // Clear max wait timeout and retry interval
    if (maxWaitTimeout) {
      clearTimeout(maxWaitTimeout);
      maxWaitTimeout = null;
    }
    if (retryCompletionInterval) {
      clearInterval(retryCompletionInterval);
      retryCompletionInterval = null;
    }
  }

  function checkStopButton() {
    const viewInfo = getViewInfo ? getViewInfo() : null;
    const position = viewInfo ? viewInfo.position : null;

    // Debug: Check if we have stop button selectors configured
    if (!config[provider]?.stopButton) {
      if (!checkStopButton.warnedNoSelector) {
        console.warn(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] No stop button selectors configured`);
        checkStopButton.warnedNoSelector = true;
      }
      return;
    }

    const stopButton = findElement(config[provider]?.stopButton, false);

    if (stopButton && !isStreaming) {
      // Stop button appeared - response started streaming
      isStreaming = true;
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] ✓ Response started (stop button detected)`);
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] Stop button element:`, stopButton.outerHTML.substring(0, 150));

      // Set max wait timeout as a safety measure
      if (!maxWaitTimeout) {
        maxWaitTimeout = setTimeout(() => {
          const pos = getViewInfo ? getViewInfo()?.position : null;
          console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${pos}] Max wait time reached, attempting completion`);
          sendCompletion();

          // If completion was blocked due to stop button, retry every 2s
          if (!hasCompletedThisCycle) {
            console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${pos}] Starting retry interval (stop button may still be present)`);
            retryCompletionInterval = setInterval(() => {
              if (!hasCompletedThisCycle) {
                sendCompletion();
              } else {
                clearInterval(retryCompletionInterval);
                retryCompletionInterval = null;
              }
            }, 2000);
          }
        }, MAX_WAIT_TIME);
      }
    } else if (!stopButton && isStreaming && !hasCompletedThisCycle && !checkStopButton.completionScheduled) {
      // Stop button disappeared - response finished
      // Use flag to prevent scheduling multiple completions
      checkStopButton.completionScheduled = true;
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] ✓ Stop button disappeared, response complete`);

      // Small delay to ensure DOM is updated
      setTimeout(() => {
        sendCompletion();
        // Reset flag after completion
        checkStopButton.completionScheduled = false;
      }, 500);
    }
  }

  function checkAndSendResponse() {
    if (!isMonitoring || hasCompletedThisCycle) return;

    // Check stop button status
    checkStopButton();

    const response = extractLatestResponse(provider, config);

    if (response && response.text && response.text !== lastResponseText) {
      lastResponseText = response.text;

      const viewInfo = getViewInfo ? getViewInfo() : null;
      const position = viewInfo ? viewInfo.position : null;

      // Only log significant updates (every 100 chars to reduce spam)
      if (response.text.length % 100 < 50 || !isStreaming) {
        console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] Response update: ${response.text.length} chars`);
      }

      // Send ongoing update
      ipcRenderer.send('response-update', {
        provider: provider,
        position: position,
        response: response,
        isStreaming: isStreaming
      });
    }
  }

  function startMonitoring() {
    const container = findElement(config[provider]?.responseContainer);

    if (!container) {
      console.warn(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}] Response container not found, retrying...`);
      setTimeout(startMonitoring, 1000);
      return;
    }

    console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}] Started response monitoring`);

    // Enable monitoring
    isMonitoring = true;

    responseObserver = new MutationObserver((mutations) => {
      checkAndSendResponse();
    });

    responseObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Do an initial check in case response is already present
    setTimeout(() => checkAndSendResponse(), 500);
  }

  // Reset monitoring when new question is submitted
  ipcRenderer.on('submit-message', () => {
    const viewInfo = getViewInfo ? getViewInfo() : null;
    const position = viewInfo ? viewInfo.position : null;

    // Reset state
    lastResponseText = '';
    hasCompletedThisCycle = false;
    isStreaming = false;
    checkStopButton.completionScheduled = false; // Reset completion flag

    // Clear existing timeouts and intervals
    if (maxWaitTimeout) clearTimeout(maxWaitTimeout);
    maxWaitTimeout = null;
    if (retryCompletionInterval) clearInterval(retryCompletionInterval);
    retryCompletionInterval = null;

    // Disable monitoring briefly to avoid capturing user message echo
    isMonitoring = false;
    console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] New question submitted, monitoring disabled for 1s`);

    // DEBUG: Run DOM inspection after response should be visible
    if (provider === 'claude' && typeof window.polygptDebugClaudeDOM === 'function') {
      setTimeout(() => {
        console.log('[DEBUG-TRIGGER] Running DOM inspection 10s after question submission...');
        window.polygptDebugClaudeDOM();
      }, 10000); // 10 seconds after submission
    }

    setTimeout(() => {
      isMonitoring = true;
      console.log(`[${provider.charAt(0).toUpperCase() + provider.slice(1)}@${position}] Monitoring re-enabled, waiting for response`);

      // Do an initial check in case response appeared during blackout
      checkAndSendResponse();
    }, 1000); // 1 second delay
  });

  return { startMonitoring };
}

function waitForDOM(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback);
  } else {
    callback();
  }
}

// Health check system - validates selectors and reports issues
function runHealthCheck(provider, config, viewInfo) {
  const results = {
    provider,
    position: viewInfo?.position || 'unknown',
    timestamp: new Date().toISOString(),
    checks: {},
    warnings: [],
    recommendations: []
  };

  console.log(`\n========== HEALTH CHECK: ${provider.toUpperCase()} ==========`);

  // Check each selector type
  const selectorTypes = ['input', 'submit', 'newChat', 'response', 'responseContainer', 'stopButton'];

  selectorTypes.forEach(type => {
    const selectors = config[provider]?.[type];
    if (!selectors) {
      results.checks[type] = { status: 'missing', found: false };
      results.warnings.push(`No ${type} selectors configured`);
      return;
    }

    const selectorsArray = Array.isArray(selectors) ? selectors : [selectors];
    let foundElement = null;
    let workingSelector = null;

    for (const selector of selectorsArray) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          foundElement = element;
          workingSelector = selector;
          break;
        }
      } catch (error) {
        results.warnings.push(`Invalid ${type} selector: ${selector} - ${error.message}`);
      }
    }

    if (foundElement) {
      results.checks[type] = {
        status: 'ok',
        found: true,
        selector: workingSelector,
        tagName: foundElement.tagName,
        visible: window.getComputedStyle(foundElement).display !== 'none'
      };
      console.log(`✓ ${type}: Found with selector "${workingSelector}"`);
    } else {
      results.checks[type] = {
        status: 'failed',
        found: false,
        triedSelectors: selectorsArray
      };
      results.warnings.push(`❌ ${type}: No element found (tried ${selectorsArray.length} selectors)`);
      console.warn(`❌ ${type}: No element found. Tried:`, selectorsArray);

      // Try auto-discovery for responses
      if (type === 'response') {
        const container = findElement(config[provider]?.responseContainer) || document.body;
        const candidates = Array.from(container.querySelectorAll('div, p, article, section')).filter(el => {
          const text = el.innerText || el.textContent || '';
          if (text.length < 50) return false;
          if (el.querySelector('input, textarea')) return false;
          if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          return true;
        });

        if (candidates.length > 0) {
          const topCandidate = candidates.sort((a, b) =>
            (b.innerText || '').length - (a.innerText || '').length
          )[0];

          // Handle className safely for SVG elements
          const className = typeof topCandidate.className === 'string'
            ? topCandidate.className
            : (topCandidate.className?.baseVal || '(no class)');

          results.recommendations.push(
            `Found ${candidates.length} potential response elements. Top candidate: ` +
            `${topCandidate.tagName}.${className || '(no class)'} ` +
            `with ${(topCandidate.innerText || '').length} chars`
          );
          console.log(`💡 Suggestion: Found ${candidates.length} potential response elements`);
        }
      }
    }
  });

  // Overall health status
  const failedChecks = Object.values(results.checks).filter(c => c.status === 'failed').length;
  const totalChecks = Object.keys(results.checks).length;
  results.healthScore = Math.round(((totalChecks - failedChecks) / totalChecks) * 100);

  console.log(`\n📊 Health Score: ${results.healthScore}% (${totalChecks - failedChecks}/${totalChecks} checks passed)`);

  if (results.warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${results.warnings.length}):`);
    results.warnings.forEach(w => console.warn(`  - ${w}`));
  }

  if (results.recommendations.length > 0) {
    console.log(`\n💡 Recommendations (${results.recommendations.length}):`);
    results.recommendations.forEach(r => console.log(`  - ${r}`));
  }

  console.log(`========== END HEALTH CHECK ==========\n`);

  // Send results to main process
  ipcRenderer.send('health-check-result', results);

  return results;
}

function setupHealthCheck(provider, config, getViewInfo, delayMs = 10000) {
  // Run health check after page loads and content stabilizes
  setTimeout(() => {
    const viewInfo = getViewInfo();
    console.log(`[${provider.toUpperCase()}] Starting health check in 10 seconds...`);
    setTimeout(() => {
      runHealthCheck(provider, config, viewInfo);
    }, delayMs);
  }, 2000);
}

module.exports = {
  loadConfig,
  findElement,
  createSubmitHandler,
  setupIPCListeners,
  setupInputScanner,
  createUIControls,
  setupViewInfoListener,
  setupSupersizeListener,
  createLoadingOverlay,
  setupLoadingOverlay,
  waitForDOM,
  extractLatestResponse,
  setupResponseMonitoring,
  setupHealthCheck,
  runHealthCheck,
};
