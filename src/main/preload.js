const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadCoordinates: () => ipcRenderer.invoke('load-coordinates'),
  saveCoordinates: (coords) => ipcRenderer.invoke('save-coordinates', coords),
  listNotes: () => ipcRenderer.invoke('list-notes'),
  readNote: (filename) => ipcRenderer.invoke('read-note', filename),
  saveNote: (data) => ipcRenderer.invoke('save-note', data),
  renameNote: (data) => ipcRenderer.invoke('rename-note', data),
  syncGit: () => ipcRenderer.invoke('sync-git'),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  deleteNote: (filename) => ipcRenderer.invoke('delete-note', filename),
  windowMoving: (delta) => ipcRenderer.send('window-moving', delta),
  fetchUrlText: (url) => ipcRenderer.invoke('fetch-url-text', url),
  readMasterTags: () => ipcRenderer.invoke('read-master-tags'),
  saveMasterTags: (tags) => ipcRenderer.invoke('save-master-tags', tags),
  appendToNote: (data) => ipcRenderer.invoke('append-to-note', data),
  loadGraphSettings: () => ipcRenderer.invoke('load-graph-settings'),
  saveGraphSettings: (settings) => ipcRenderer.invoke('save-graph-settings', settings),
  
  // Gitステータス変更の通知リスナー
  onGitStatusChanged: (callback) => {
    const subscription = (event, status, error) => callback(status, error);
    ipcRenderer.on('git-status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('git-status-changed', subscription);
    };
  }
});
