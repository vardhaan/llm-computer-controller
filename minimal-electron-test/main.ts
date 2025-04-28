// minimal-electron-test/main.ts
import { app, BrowserWindow } from 'electron';
import * as path from 'path';

function createWindow() {
  console.log('[Minimal Main] Creating window...');
  // Important: Use __dirname which points to dist/ after compilation
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log(`[Minimal Main] Preload path SHOULD BE: ${preloadPath}`);

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  // Verify the path Electron tries to load
  console.log(`[Minimal Main] Attempting to load preload script using path: ${preloadPath}`);

  // Check if file exists *before* loading URL
  try {
    require('fs').accessSync(preloadPath);
    console.log(`[Minimal Main] Preload script file confirmed to exist at: ${preloadPath}`);
  } catch (error) {
      console.error(`[Minimal Main] ERROR: Preload script file NOT FOUND at: ${preloadPath}`, error);
  }


  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools(); // Open dev tools automatically
}

app.whenReady().then(() => {
  console.log('[Minimal Main] App ready.');
  createWindow();
});

app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
      app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
  }
}); 