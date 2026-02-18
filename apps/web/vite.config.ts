import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveWorkspacePackage(packagePath: string) {
  const localPath = path.resolve(__dirname, 'node_modules', packagePath);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  const hoistedPath = path.resolve(__dirname, '../../node_modules', packagePath);
  if (fs.existsSync(hoistedPath)) {
    return hoistedPath;
  }

  return localPath;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Keep a single Tiptap/PM runtime to avoid decoration/view crashes
      { find: '@tiptap/core', replacement: resolveWorkspacePackage('@tiptap/core') },
      { find: '@tiptap/pm', replacement: resolveWorkspacePackage('@tiptap/pm') },
      // Tiptap CLI template scaffold root (`apps/web/@/...`)
      { find: '@/', replacement: `${path.resolve(__dirname, '@')}/` },
    ],
  },
});
