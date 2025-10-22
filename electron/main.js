const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Helper: try to detect a running dev server on localhost ports 3000..3010
function checkPort(port, timeout = 500) {
  return new Promise((resolve) => {
    const req = http.request({ method: 'HEAD', host: '127.0.0.1', port, path: '/', timeout }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) {}
      resolve(false);
    });
    req.end();
  });
}

async function resolveDevUrl() {
  if (process.env.ELECTRON_START_URL) return process.env.ELECTRON_START_URL;
  // respect explicit Vite port env if provided
  if (process.env.PORT) return `http://localhost:${process.env.PORT}`;
  // scan a small range for an available dev server
  const start = 3000;
  const end = 3010;
  for (let p = start; p <= end; p++) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkPort(p);
    if (ok) return `http://localhost:${p}`;
  }
  // fallback to 3000 if nothing detected
  return 'http://localhost:3000';
}

// window state persistence
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  // Window-state persistence disabled: do not read any saved window bounds from disk.
  // This prevents the app from leaving hidden state files in the user's profile.
  return null;
}

function saveWindowState(state) {
  // Window-state persistence disabled: no-op to avoid writing files to disk.
  // If you need to re-enable persistence later, restore the original implementation.
  return;
}

async function createWindow() {
  // Force a fixed initial window size and center it on screen
  const DEFAULT_WIDTH = 1100;
  const DEFAULT_HEIGHT = 900;
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  const x = undefined;
  const y = undefined;
  const isMaximized = false;


  // create with useContentSize so width/height refer to content area and center the window
  const win = new BrowserWindow({
    width,
    height,
    center: true,
    useContentSize: true,
    resizable: false, // fixed size as requested
    // to avoid needing to recreate the window when toggling transparency,
    // create the window frameless and transparent from the start and toggle
    // visual styles from the renderer (CSS) only. This keeps the same
    // renderer process and preserves JS memory/state.
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isMaximized) win.maximize();

    // In development prefer the dev server URL so preload and IPC are available
    let url;
    if (process.env.NODE_ENV === 'development') {
      url = await resolveDevUrl();
    } else {
      url = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '..', 'build', 'index.html')}`;
    }
    console.log('Electron: loading URL ->', url);
    await win.loadURL(url);

  // Do not open devtools automatically on startup.
  // If you need devtools, open them manually via the menu or set an env flag.

  // persist window state on move/resize/close
  let saveTimeout = null;
  const doSave = () => {
    try {
      if (saveTimeout) clearTimeout(saveTimeout);
    } catch {}
    saveTimeout = setTimeout(() => {
      try {
        const isMax = win.isMaximized();
        // always save content size (so switching frame doesn't change content area)
        const windowBounds = win.getBounds();
        const contentBounds = win.getContentBounds();
        const toSave = isMax ? (lastState || { x: windowBounds.x, y: windowBounds.y, width: contentBounds.width, height: contentBounds.height }) : { x: windowBounds.x, y: windowBounds.y, width: contentBounds.width, height: contentBounds.height };
        saveWindowState({ x: toSave.x, y: toSave.y, width: toSave.width, height: toSave.height, isMaximized: isMax });
      } catch (e) {
        console.warn('Failed saving window bounds', e);
      }
    }, 300);
  };

  win.on('move', doSave);
  win.on('resize', doSave);
  win.on('close', doSave);
}

// recreate window with different frame/transparent settings
let currentIsTransparent = false;

// recreateWindow remains for API compatibility but snapshot usage removed
async function recreateWindow({ transparent }) {
  return new Promise(async (resolve, reject) => {
    // store old bounds and maximized state
    const oldWin = BrowserWindow.getAllWindows()[0];
    const oldBounds = oldWin ? oldWin.getBounds() : { width: 1100, height: 700, x: undefined, y: undefined };
    const wasMax = oldWin ? oldWin.isMaximized() : false;

    // Snapshot capture/restore disabled — do not request snapshot from old renderer.
    const captureSnapshot = () => Promise.resolve(null);

    // create new window first
    try {
      // wait for snapshot attempt (don't block long)
      captureSnapshot().catch(() => {});

      // create using content size (useContentSize) so the width/height refer to content area
      const newWin = new BrowserWindow({
        width: oldBounds.width,
        height: oldBounds.height,
        x: oldBounds.x,
        y: oldBounds.y,
        useContentSize: true,
        resizable: false,
        frame: transparent ? false : true,
        transparent: !!transparent,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      if (wasMax) newWin.maximize();
      let url;
      if (process.env.NODE_ENV === 'development') {
        url = await resolveDevUrl();
      } else {
        url = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '..', 'build', 'index.html')}`;
      }
      console.log('Electron (recreate): loading URL ->', url);
      await newWin.loadURL(url);

      // wait for the new window to be ready then close the old one
      const whenReady = () => new Promise((res) => {
        if (newWin.webContents.isLoading()) {
          newWin.webContents.once('did-finish-load', res);
          // fallback to ready-to-show
          newWin.once('ready-to-show', res);
        } else {
          res();
        }
      });

      whenReady().then(() => {
        try {
          if (oldWin && !oldWin.isDestroyed()) {
            oldWin.removeAllListeners();
            oldWin.close();
          }
          // register persistence listeners on new window
          let saveTimeout = null;
          const doSave = () => {
            try {
              if (saveTimeout) clearTimeout(saveTimeout);
            } catch {}
            saveTimeout = setTimeout(() => {
              try {
                const isMax = newWin.isMaximized();
                const bounds = isMax ? oldBounds : newWin.getBounds();
                saveWindowState({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, isMaximized: isMax });
              } catch (e) {
                console.warn('Failed saving window bounds', e);
              }
            }, 300);
          };
          newWin.on('move', doSave);
          newWin.on('resize', doSave);
          newWin.on('close', doSave);
          currentIsTransparent = !!transparent;
          // persist the mode after successful recreation (no-op - transparency fixed)
          resolve(true);
        } catch (e) {
          console.error('Error while switching windows:', e);
          reject(e);
        }
      }).catch((err) => {
        console.error('Window ready error', err);
        reject(err);
      });
    } catch (err) {
      console.error('Failed to recreate window:', err);
      reject(err);
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers for save/open and capture
const { dialog, nativeImage, ipcMain } = require('electron');

// transparent IPC handlers removed; transparency is always enabled

// allow renderer to read the snapshot file saved during window recreate
// read-app-snapshot handler removed: snapshot feature disabled

ipcMain.handle('save-file', async (event, { data, defaultPath }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath || 'lineup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!filePath) return { canceled: true };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return { canceled: false, filePath };
});

ipcMain.handle('open-file', async (event) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { canceled: true };
  const content = fs.readFileSync(filePaths[0], 'utf8');
  try {
    const data = JSON.parse(content);
    return { canceled: false, filePath: filePaths[0], data };
  } catch (err) {
    return { canceled: false, filePath: filePaths[0], data: null, error: err.message };
  }
});

ipcMain.handle('capture-and-save', async (event, { team, defaultPath, rect }) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { canceled: true };
  // If rect provided, capture that region in device pixels
  let image;
  try {
    if (rect && typeof rect === 'object') {
      // rect should be { x, y, width, height } in device pixels
      image = await win.webContents.capturePage(rect);
    } else {
      image = await win.capturePage();
    }
  } catch (err) {
    // fallback to full capture
    image = await win.capturePage();
  }
  const buffer = image.toPNG();
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath || `${team || 'screenshot'}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (!filePath) return { canceled: true };
  fs.writeFileSync(filePath, buffer);
  return { canceled: false, filePath };
});

// window control handlers
ipcMain.handle('window-minimize', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.handle('window-maximize', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.maximize();
});

ipcMain.handle('window-close', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

ipcMain.handle('window-is-maximized', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? win.isMaximized() : false;
});

ipcMain.handle('window-toggle-maximize', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
