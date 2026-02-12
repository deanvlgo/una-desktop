import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const DEFAULT_HOCUS_URL = 'ws://localhost:1234';

function hocusUrl() {
  const raw = import.meta.env.VITE_HOCUS_URL;
  if (!raw) {
    return DEFAULT_HOCUS_URL;
  }
  return String(raw).trim();
}

export type PresenceRoomConnection = {
  docName: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
};

export function connectPresenceRoom(docName: string, token: string): PresenceRoomConnection {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: hocusUrl(),
    name: docName,
    document: doc,
    token,
  });
  return { docName, doc, provider };
}

export function disconnectPresenceRoom(connection: PresenceRoomConnection) {
  connection.provider.destroy();
  connection.doc.destroy();
}
