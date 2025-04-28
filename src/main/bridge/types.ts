export interface SystemBridge {
  listApplications(): Promise<AppInfo[]>;
  openPath(path: string): Promise<void>;
  searchFiles(query: string): Promise<FileInfo[]>;
}

export interface AppInfo {
  name: string;
  path: string;
}

export interface FileInfo {
  name: string;
  path: string;
} 