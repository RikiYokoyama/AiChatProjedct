/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    loadConfig: () => Promise<{
      geminiApiKey: string;
      notesPath: string;
      gitRemoteUrl: string;
      autoSync: boolean;
    }>;
    saveConfig: (config: {
      geminiApiKey?: string;
      notesPath?: string;
      gitRemoteUrl?: string;
      autoSync?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    listNotes: () => Promise<Array<{
      name: string;
      path: string;
      updatedAt: string;
      content: string;
    }>>;
    saveNote: (data: { filename: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
    renameNote: (data: { oldFilename: string; newFilename: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
    syncGit: () => Promise<{ success: boolean; error?: string }>;
    openDirectoryDialog: () => Promise<string | null>;
    deleteNote: (filename: string) => Promise<{ success: boolean; error?: string }>;
    onGitStatusChanged: (callback: (status: 'idle' | 'syncing' | 'success' | 'error', error?: string) => void) => () => void;
    windowMoving: (delta: { deltaX: number; deltaY: number }) => void;
    fetchUrlText: (url: string) => Promise<string>;
  };
}
