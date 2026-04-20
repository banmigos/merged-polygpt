const { app, ipcMain } = require('electron');
const windowManager = require('./window-manager');
const path = require('path');
const fs = require('fs');

let mainWindow;
let currentZoomFactor = 1.0;

// Merge mode state
const mergeState = {
  mergeModeEnabled: false,
  mergerWindow: 'bottomRight',
  mergeTimeout: 300, // 5 minutes default
  autoMerge: true, // Auto-merge by default
  responses: {
    topLeft: null,
    topRight: null,
    bottomLeft: null,
    bottomRight: null
  },
  completedCount: 0,
  autoMergeTimer: null,
  currentQuestion: '',
  mergeInProgress: false // true while merger window is generating the merged response
};

const SETTINGS_FILE = path.join(app.getPath('userData'), 'merge-settings.json');

function loadMergeSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const settings = JSON.parse(data);
      mergeState.mergeModeEnabled = settings.mergeModeEnabled || false;
      mergeState.mergerWindow = settings.mergerWindow || 'bottomRight';
      mergeState.mergeTimeout = settings.mergeTimeout !== undefined ? settings.mergeTimeout : 300;
      mergeState.autoMerge = settings.autoMerge !== undefined ? settings.autoMerge : true;
      console.log('Loaded merge settings:', settings);
    }
  } catch (error) {
    console.error('Failed to load merge settings:', error);
  }
}

function saveMergeSettings() {
  try {
    const settings = {
      mergeModeEnabled: mergeState.mergeModeEnabled,
      mergerWindow: mergeState.mergerWindow,
      mergeTimeout: mergeState.mergeTimeout,
      autoMerge: mergeState.autoMerge
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    console.log('Saved merge settings:', settings);
  } catch (error) {
    console.error('Failed to save merge settings:', error);
  }
}

function getPositionFromProvider(provider) {
  // Find which position has this provider
  if (!mainWindow || !mainWindow.viewPositions) return null;

  for (const [position, view] of Object.entries(mainWindow.viewPositions)) {
    if (view && view.providerKey === provider) {
      return position;
    }
  }
  return null;
}

async function performMerge() {
  if (!mergeState.mergeModeEnabled) {
    console.log('[Merge] Merge mode disabled, skipping');
    return;
  }

  console.log('[Merge] Performing merge operation');

  // Collect the responses (excluding merger window) and assign sequential citation numbers
  const responsesToMerge = [];
  let citationNum = 0;

  windowManager.POSITIONS.forEach(pos => {
    if (pos !== mergeState.mergerWindow && mergeState.responses[pos]) {
      citationNum++;
      // Get provider name for this position
      const view = mainWindow.viewPositions[pos];
      const providerKey = view ? view.providerKey : 'unknown';
      const providerName = providerKey.charAt(0).toUpperCase() + providerKey.slice(1);

      responsesToMerge.push({
        citationNum: citationNum,
        provider: providerName,
        position: pos,
        text: mergeState.responses[pos].text || 'No response yet'
      });
    }
  });

  if (responsesToMerge.length === 0) {
    console.log('[Merge] No responses to merge');
    return;
  }

  // Build dynamic window mapping based on actual responses
  const windowMapping = responsesToMerge.map(r =>
    `   - **[${r.citationNum}]** = ${r.provider}`
  ).join('\n');

  // Build the merge prompt with citations
  const mergePrompt = `Below is a question and ${responsesToMerge.length} responses from different AI assistants. Your task is to synthesize these responses into a single, comprehensive answer.

CITATION RULES (VERY IMPORTANT):
1. Each response may contain references to papers, websites, or other sources
2. When citing information in your merged answer:
   - **If the statement is backed by a specific source** (paper, website, document) mentioned in one of the responses:
     Cite it as: **[# : Source Title/URL]**
     Example: **[1: Nature 2023]**, **[2: arxiv.org/1234]**, **[3: WHO Guidelines]**

   - **If the statement comes from an LLM's analysis without a specific source**:
     Cite just the number: **[1]**, **[2]**, or **[3]**
     Example: "According to the analysis **[2]**..."

3. Source mapping:
${windowMapping}

4. Always use bold formatting for citations
5. Extract and preserve the actual sources from the original responses when they exist

Original Question: ${mergeState.currentQuestion}

${responsesToMerge.map(r => `Response from ${r.provider} [${r.citationNum}]:
${r.text}`).join('\n\n---\n\n')}

Please provide a merged, comprehensive answer with proper citations following the rules above:`;

  const mergerView = mainWindow.viewPositions[mergeState.mergerWindow];
  const mergerProviderKey = mergerView ? mergerView.providerKey : 'unknown';
  console.log(`[Merge] Sending merge prompt to merger window: ${mergeState.mergerWindow} (${mergerProviderKey})`);

  // Mark merge in progress BEFORE sending the prompt
  mergeState.mergeInProgress = true;

  // Send the merge prompt to the merger window
  if (mergerView && mergerView.webContents) {
    mergerView.webContents.send('text-update', mergePrompt);

    // Auto-submit after a brief delay to allow text to be injected
    setTimeout(() => {
      mergerView.webContents.send('submit-message');
    }, 500);
  }

  // Reset collection state for next question (but keep mergeInProgress = true)
  mergeState.responses = {
    topLeft: null,
    topRight: null,
    bottomLeft: null,
    bottomRight: null
  };
  mergeState.completedCount = 0;
  mergeState.currentQuestion = '';

  // Update status to show merge is in progress
  if (mainWindow.mainView && mainWindow.mainView.webContents) {
    mainWindow.mainView.webContents.send('response-status-update', {
      count: 3,
      total: 3,
      merging: true
    });
  }
}

app.on('ready', async () => {
  mainWindow = await windowManager.createWindow();

  // IPC handler for text updates from renderer
  ipcMain.handle('send-text-update', async (event, text) => {
    const supersizedPosition = mainWindow.getSupersizedPosition ? mainWindow.getSupersizedPosition() : null;

    // Store the question for merge mode
    if (mergeState.mergeModeEnabled) {
      mergeState.currentQuestion = text;
    }

    // If supersized, only send to that position
    if (supersizedPosition) {
      const view = mainWindow.viewPositions[supersizedPosition];
      if (view && view.webContents) {
        view.webContents.send('text-update', text);
      }
    } else if (mergeState.mergeModeEnabled) {
      // In merge mode, send to all positions EXCEPT the merger window
      windowManager.POSITIONS.forEach(pos => {
        if (pos !== mergeState.mergerWindow) {
          const view = mainWindow.viewPositions[pos];
          if (view && view.webContents) {
            view.webContents.send('text-update', text);
          }
        }
      });
    } else {
      // Normal mode: Send text to all positions
      windowManager.POSITIONS.forEach(pos => {
        const view = mainWindow.viewPositions[pos];
        if (view && view.webContents) {
          view.webContents.send('text-update', text);
        }
      });
    }
  });

  ipcMain.handle('selector-error', async (event, source, error) => {
    if (mainWindow.mainView && mainWindow.mainView.webContents) {
      mainWindow.mainView.webContents.send('selector-error', { source, error });
    }
  });

  ipcMain.handle('rescan-selectors', async (event) => {
    windowManager.POSITIONS.forEach(pos => {
      const view = mainWindow.viewPositions[pos];
      if (view && view.webContents) {
        view.webContents.reload();
      }
    });
    return true;
  });

  ipcMain.handle('refresh-pages', async (event) => {
    const reloadPromises = windowManager.POSITIONS.map(pos => {
      return new Promise((resolve) => {
        const view = mainWindow.viewPositions[pos];
        if (view && view.webContents) {
          const onLoad = () => {
            view.webContents.setZoomFactor(currentZoomFactor);
            view.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          };
          view.webContents.on('did-finish-load', onLoad);
          view.webContents.reload();
        } else {
          resolve();
        }
      });
    });
    await Promise.all(reloadPromises);
    return true;
  });

  // Handle submit message request
  ipcMain.handle('submit-message', async (event) => {
    const supersizedPosition = mainWindow.getSupersizedPosition ? mainWindow.getSupersizedPosition() : null;

    // Reset merge state when submitting a new question
    if (mergeState.mergeModeEnabled) {
      mergeState.responses = {
        topLeft: null,
        topRight: null,
        bottomLeft: null,
        bottomRight: null
      };
      mergeState.completedCount = 0;
      mergeState.mergeInProgress = false;

      // Clear any existing timeout
      if (mergeState.autoMergeTimer) {
        clearTimeout(mergeState.autoMergeTimer);
        mergeState.autoMergeTimer = null;
      }

      // Update status
      if (mainWindow.mainView && mainWindow.mainView.webContents) {
        mainWindow.mainView.webContents.send('response-status-update', {
          count: 0,
          total: 3
        });
      }
    }

    // If supersized, only submit to that position
    if (supersizedPosition) {
      const view = mainWindow.viewPositions[supersizedPosition];
      if (view && view.webContents) {
        view.webContents.send('submit-message');
      }
    } else if (mergeState.mergeModeEnabled) {
      // In merge mode, submit to all positions EXCEPT the merger window
      windowManager.POSITIONS.forEach(pos => {
        if (pos !== mergeState.mergerWindow) {
          const view = mainWindow.viewPositions[pos];
          if (view && view.webContents) {
            view.webContents.send('submit-message');
          }
        }
      });
    } else {
      // Normal mode: Submit to all positions
      windowManager.POSITIONS.forEach(pos => {
        const view = mainWindow.viewPositions[pos];
        if (view && view.webContents) {
          view.webContents.send('submit-message');
        }
      });
    }
    return true;
  });

  // Handle new chat request
  ipcMain.handle('new-chat', async (event) => {
    windowManager.POSITIONS.forEach(pos => {
      const view = mainWindow.viewPositions[pos];
      if (view && view.webContents) {
        view.webContents.send('new-chat');
      }
    });
    return true;
  });

  // Handle zoom in request
  ipcMain.handle('zoom-in', async (event) => {
    const newZoom = Math.min(currentZoomFactor + 0.1, 2.0); // Max 200%
    currentZoomFactor = newZoom;

    windowManager.POSITIONS.forEach(pos => {
      const view = mainWindow.viewPositions[pos];
      if (view && view.webContents) {
        view.webContents.setZoomFactor(newZoom);
      }
    });

    return newZoom;
  });

  // Handle zoom out request
  ipcMain.handle('zoom-out', async (event) => {
    const newZoom = Math.max(currentZoomFactor - 0.1, 0.5); // Min 50%
    currentZoomFactor = newZoom;

    windowManager.POSITIONS.forEach(pos => {
      const view = mainWindow.viewPositions[pos];
      if (view && view.webContents) {
        view.webContents.setZoomFactor(newZoom);
      }
    });

    return newZoom;
  });

  // Handle toggle supersize request
  ipcMain.handle('toggle-supersize', async (event, position) => {
    if (mainWindow.toggleSupersize) {
      const supersizedPosition = mainWindow.toggleSupersize(position);
      return supersizedPosition;
    }
    return null;
  });

  // Handle change provider request
  ipcMain.handle('change-provider', async (event, position, newProvider) => {
    if (mainWindow.changeProvider) {
      return mainWindow.changeProvider(position, newProvider, currentZoomFactor);
    }
    return false;
  });

  // Load merge settings on startup
  loadMergeSettings();

  // Merge mode IPC handlers
  ipcMain.handle('get-merge-settings', async () => {
    return {
      mergeModeEnabled: mergeState.mergeModeEnabled,
      mergerWindow: mergeState.mergerWindow,
      mergeTimeout: mergeState.mergeTimeout,
      autoMerge: mergeState.autoMerge
    };
  });

  ipcMain.handle('set-merge-mode', async (event, enabled) => {
    mergeState.mergeModeEnabled = enabled;
    saveMergeSettings();
    return true;
  });

  ipcMain.handle('set-merger-window', async (event, position) => {
    mergeState.mergerWindow = position;
    saveMergeSettings();

    // Notify all windows about the merger window change
    windowManager.POSITIONS.forEach(pos => {
      const view = mainWindow.viewPositions[pos];
      if (view && view.webContents) {
        view.webContents.send('merger-window-changed', position);
      }
    });

    return true;
  });

  ipcMain.handle('set-merge-timeout', async (event, timeout) => {
    mergeState.mergeTimeout = timeout;
    saveMergeSettings();
    return true;
  });

  ipcMain.handle('set-auto-merge', async (event, enabled) => {
    mergeState.autoMerge = enabled;
    saveMergeSettings();
    return true;
  });

  ipcMain.handle('merge-now', async () => {
    if (mergeState.autoMergeTimer) {
      clearTimeout(mergeState.autoMergeTimer);
      mergeState.autoMergeTimer = null;
    }
    await performMerge();
    return true;
  });

  // Listen for response updates from preload scripts
  ipcMain.on('response-update', (event, data) => {
    if (!mergeState.mergeModeEnabled) return;

    const position = data.position;
    // Only track responses from non-merger windows, and not during an in-progress merge
    if (position && position !== mergeState.mergerWindow && !mergeState.mergeInProgress) {
      mergeState.responses[position] = data.response;
      console.log(`[Merge] Response update from ${position} (${data.provider})`);
    }
  });

  // Listen for response completion
  ipcMain.on('response-complete', (event, data) => {
    if (!mergeState.mergeModeEnabled) return;

    const position = data.position;

    // Handle merger window's response
    if (position === mergeState.mergerWindow) {
      if (mergeState.mergeInProgress) {
        // Merger finished generating the merged response
        mergeState.mergeInProgress = false;
        console.log(`[Merge] ✓ Merge complete from ${position} (${data.provider}) - ${(data.response?.text || '').length} chars`);

        // Update status to show merge is complete
        if (mainWindow.mainView && mainWindow.mainView.webContents) {
          mainWindow.mainView.webContents.send('response-status-update', {
            count: 3,
            total: 3,
            mergeComplete: true
          });
        }
      }
      // Always skip counting merger window responses toward the next merge
      return;
    }

    // Ignore late responses from non-merger windows if a merge is already in progress
    if (mergeState.mergeInProgress) {
      console.log(`[Merge] Ignoring late response from ${position} (${data.provider}) - merge already in progress`);
      return;
    }

    // Count responses from non-merger windows
    if (position) {
      mergeState.responses[position] = data.response;
      mergeState.completedCount++;

      console.log(`[Merge] Response complete from ${position} (${data.provider}) - ${mergeState.completedCount}/3`);

      // Update status in control bar
      if (mainWindow.mainView && mainWindow.mainView.webContents) {
        mainWindow.mainView.webContents.send('response-status-update', {
          count: mergeState.completedCount,
          total: 3
        });
      }

      // Check if all 3 non-merger windows are complete
      if (mergeState.completedCount >= 3) {
        // Clear any existing timer
        if (mergeState.autoMergeTimer) {
          clearTimeout(mergeState.autoMergeTimer);
        }

        if (mergeState.autoMerge) {
          // Auto-merge enabled: trigger merge immediately
          console.log('[Merge] Auto-merge enabled, performing merge');
          performMerge();
        } else {
          // Manual merge: notify user that responses are ready
          console.log('[Merge] Manual merge mode: all responses ready, waiting for user action');
          if (mainWindow.mainView && mainWindow.mainView.webContents) {
            mainWindow.mainView.webContents.send('merge-ready');
          }
        }
      } else if (mergeState.mergeTimeout > 0 && !mergeState.autoMergeTimer && mergeState.autoMerge) {
        // Start timeout timer if not already started (only for auto-merge)
        mergeState.autoMergeTimer = setTimeout(() => {
          console.log('[Merge] Timeout reached, merging available responses');
          performMerge();
        }, mergeState.mergeTimeout * 1000);
      }
    }
  });

  // Health check results collection
  const healthCheckResults = {};

  ipcMain.on('health-check-result', (event, result) => {
    healthCheckResults[result.position] = result;

    console.log(`\n🏥 HEALTH CHECK RESULT: ${result.provider.toUpperCase()} @ ${result.position}`);
    console.log(`   Health Score: ${result.healthScore}%`);

    if (result.warnings.length > 0) {
      console.log(`   ⚠️  Warnings: ${result.warnings.length}`);
      result.warnings.forEach(w => console.log(`      - ${w}`));
    }

    if (result.recommendations.length > 0) {
      console.log(`   💡 Recommendations: ${result.recommendations.length}`);
      result.recommendations.forEach(r => console.log(`      - ${r}`));
    }

    // Check if we have all 4 health checks (excluding control bar)
    const positions = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    const completedChecks = positions.filter(pos => healthCheckResults[pos]).length;

    if (completedChecks === 4) {
      console.log('\n========================================');
      console.log('🏥 ALL HEALTH CHECKS COMPLETE');
      console.log('========================================');

      const allChecks = positions.map(pos => healthCheckResults[pos]);
      const avgScore = Math.round(allChecks.reduce((sum, r) => sum + r.healthScore, 0) / 4);
      const totalWarnings = allChecks.reduce((sum, r) => sum + r.warnings.length, 0);
      const failingProviders = allChecks.filter(r => r.healthScore < 100);

      console.log(`📊 Overall Health: ${avgScore}%`);
      console.log(`⚠️  Total Warnings: ${totalWarnings}`);

      if (failingProviders.length > 0) {
        console.log(`\n❌ Providers with issues (${failingProviders.length}):`);
        failingProviders.forEach(r => {
          console.log(`   - ${r.provider} @ ${r.position}: ${r.healthScore}%`);
        });
      } else {
        console.log('✅ All providers healthy!');
      }

      console.log('========================================\n');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (mainWindow === null) {
    mainWindow = await windowManager.createWindow();
  }
});

