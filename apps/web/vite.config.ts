import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Keep a single Tiptap/PM runtime to avoid decoration/view crashes
      '@tiptap/core': path.resolve(__dirname, 'node_modules/@tiptap/core'),
      '@tiptap/pm': path.resolve(__dirname, 'node_modules/@tiptap/pm'),
    },
  },
});
