import { contextBridge, ipcRenderer } from 'electron';

console.log('[Preload] Script starting - IPC Bridge');

// Expose protected methods that allow the renderer process to invoke
// main process logic via IPC
const api = {
  listApplications: () => ipcRenderer.invoke('list-applications'),
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),
  searchFiles: (query: string) => ipcRenderer.invoke('search-files', query),
  llmQuery: (query: string) => ipcRenderer.invoke('llm-query', query)
};

try {
  console.log('[Preload] Attempting contextBridge.exposeInMainWorld("api", api)');
  contextBridge.exposeInMainWorld('api', api);
  console.log('[Preload] contextBridge.exposeInMainWorld succeeded.');
} catch (error) {
  console.error('[Preload] Failed to set up ContextBridge:', error);
} 