import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';

const DEFAULT_PORT = 1234;
const DEFAULT_HOST = '127.0.0.1';

const port = Number(process.env.HOCUSPOCUS_PORT ?? DEFAULT_PORT);
const host = process.env.HOCUSPOCUS_HOST ?? DEFAULT_HOST;

const dataDir =
  process.env.HOCUSPOCUS_DATA_DIR != null
    ? path.resolve(process.env.HOCUSPOCUS_DATA_DIR)
    : path.resolve(fileURLToPath(new URL('../.hocuspocus-data', import.meta.url)));

function roomFilename(documentName: string): string {
  const encoded = Buffer.from(documentName, 'utf8').toString('base64url');
  return `${encoded}.bin`;
}

function roomFilePath(documentName: string): string {
  return path.join(dataDir, roomFilename(documentName));
}

async function loadDocument(documentName: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const filePath = roomFilePath(documentName);

  try {
    const buffer = await fs.readFile(filePath);
    Y.applyUpdate(doc, new Uint8Array(buffer));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  return doc;
}

async function storeDocument(documentName: string, doc: Y.Doc): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const update = Y.encodeStateAsUpdate(doc);
  await fs.writeFile(roomFilePath(documentName), Buffer.from(update));
}

async function main(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  const server = Server.configure({
    port,
    address: host,
    async onLoadDocument(data) {
      return loadDocument(data.documentName);
    },
    async onStoreDocument(data) {
      await storeDocument(data.documentName, data.document);
    },
    async onConnect(data) {
      console.log(`[hocuspocus] connect document=${data.documentName}`);
    },
    async onDisconnect(data) {
      console.log(`[hocuspocus] disconnect document=${data.documentName}`);
    },
  });

  await server.listen();
  console.log(`[hocuspocus] listening on ws://${host}:${port}`);
  console.log(`[hocuspocus] persistence directory: ${dataDir}`);
}

main().catch((error) => {
  console.error('[hocuspocus] fatal error', error);
  process.exit(1);
});
