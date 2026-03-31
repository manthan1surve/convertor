const { app, BrowserWindow, session, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false // Don't show until ready-to-show to prevent visual flash
  });

  // Remove the default menu bar for a cleaner "app" look
  mainWindow.setMenuBarVisibility(false);

  // Setup headers required for FFmpeg SharedArrayBuffer (Cross-Origin Isolation)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    });
  });

  // Load the html file
  mainWindow.loadFile('VideoConverter.html');

  // Show the window when the page is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  // Handle save-file IPC: open a Save As dialog and copy temp → chosen path
  ipcMain.handle('save-file', async (event, { tempPath, defaultName }) => {
    try {
      console.log('IPC: save-file requested', { tempPath, defaultName });
      const result = await dialog.showSaveDialog(mainWindow || null, {
        title: 'Save Converted Video',
        defaultPath: defaultName,
        filters: [{ name: 'All Files', extensions: ['*'] }]
      });
      console.log('IPC: Save dialog result', result);
      if (!result.canceled && result.filePath) {
        fs.copyFileSync(tempPath, result.filePath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return { success: true, path: result.filePath };
      }
      return { success: false, cancelled: result.canceled };
    } catch (err) {
      console.error('IPC: Failed to save/move file', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      console.log('IPC: delete-file requested', filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch (err) {
      console.error('IPC: Failed to delete file', err);
    }
    return false;
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up any stray temp files on quit
app.on('will-quit', () => {
  const tempDir = require('os').tmpdir();
  try {
    const files = fs.readdirSync(tempDir);
    files.forEach(f => {
      if (f.includes('_converted_') && (f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi'))) {
        try { fs.unlinkSync(path.join(tempDir, f)); } catch (e) { }
      }
    });
  } catch (e) { }
});
