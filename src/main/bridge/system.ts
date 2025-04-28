import { promises as fs } from 'fs';
import { shell } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { AppInfo, FileInfo } from './types';

const execFileAsync = promisify(execFile);

export async function listApplications(): Promise<AppInfo[]> {
  const appsDir = '/Applications';
  const files = await fs.readdir(appsDir);
  
  const apps = files
    .filter(file => file.endsWith('.app'))
    .map(file => ({
      name: path.basename(file, '.app'),
      path: path.join(appsDir, file)
    }));

  return apps;
}

export async function openPath(filePath: string): Promise<void> {
  await shell.openPath(filePath);
}

export async function searchFiles(query: string): Promise<FileInfo[]> {
  const { stdout } = await execFileAsync('mdfind', [query]);
  
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(filePath => ({
      name: path.basename(filePath),
      path: filePath
    }));
} 