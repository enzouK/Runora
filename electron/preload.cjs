/**
 * Preload — the only bridge between the sandboxed renderer and the main
 * process. Exposes just what the app needs to save files natively;
 * everything else stays ordinary web code.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ankiDesktop', {
  isDesktop: true,
  /** Opens the native Save As dialog. Returns { canceled:true } or { path }. */
  pickSavePath: (suggestedName, extFilters) =>
    ipcRenderer.invoke('desktop:pick-save-path', suggestedName, extFilters),
  /** Writes bytes to an already-picked path. Returns { saved } / { saved:false, error }. */
  writeFile: (filePath, bytes) => ipcRenderer.invoke('desktop:write-file', filePath, bytes),
  /** Addons folder bridge (main process roots it at userData/Addons). */
  addonsRoot: () => ipcRenderer.invoke('desktop:addons-root'),
  addonsEnsure: () => ipcRenderer.invoke('desktop:addons-ensure'),
  addonsList: () => ipcRenderer.invoke('desktop:addons-list'),
  addonsExists: (rel) => ipcRenderer.invoke('desktop:addons-exists', rel),
  addonsRead: (rel, encoding) => ipcRenderer.invoke('desktop:addons-read', rel, encoding),
  addonsWrite: (rel, encoding, data) => ipcRenderer.invoke('desktop:addons-write', rel, encoding, data),
  addonsRemove: (rel) => ipcRenderer.invoke('desktop:addons-remove', rel),
});
