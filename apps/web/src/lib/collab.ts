import { HocuspocusProvider } from '@hocuspocus/provider';

import type { CollectionManifestDoc, SeriesDoc } from '../../../../src/contracts/types';

type CollabUser = {
  id: string;
  name: string;
  color: string;
};

type DocSeed = {
  docName: string;
  initialValue: CollectionManifestDoc | SeriesDoc;
};

type PresenceState = {
  clientId: number;
  isLocal: boolean;
  user: CollabUser;
  focusId: string | null;
  catalogCursor: {
    fieldId: string;
    position: number | null;
  } | null;
};

type CollabClientOptions = {
  url: string;
  user: CollabUser;
  onDocChanged?: (docName: string) => void;
  onPresenceChanged?: () => void;
};

type JsonMapValue = CollectionManifestDoc | SeriesDoc;

type RoomState = {
  provider: HocuspocusProvider;
  map: MapLike;
  seed: JsonMapValue;
};

type MapLike = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  observe: (handler: () => void) => void;
  unobserve: (handler: () => void) => void;
};

export class CollabClient {
  private readonly options: CollabClientOptions;

  private readonly rooms = new Map<string, RoomState>();

  private readonly mapObservers = new Map<string, () => void>();

  private readonly awarenessObservers = new Map<string, () => void>();

  private readonly publishSignatures = new Map<string, string>();

  private readonly syncedRooms = new Set<string>();

  constructor(options: CollabClientOptions) {
    this.options = options;
  }

  connectRoom(seed: DocSeed): void {
    if (this.rooms.has(seed.docName)) {
      return;
    }

    const provider = new HocuspocusProvider({
      url: this.options.url,
      name: seed.docName,
      onSynced: ({ state }) => {
        if (!state) {
          this.syncedRooms.delete(seed.docName);
          return;
        }
        this.syncedRooms.add(seed.docName);

        const room = this.rooms.get(seed.docName);
        if (!room) {
          return;
        }

        if (room.map.get('json') == null) {
          room.map.set('json', structuredClone(room.seed));
        }
        this.options.onDocChanged?.(seed.docName);
      },
    });

    provider.setAwarenessField('user', this.options.user);
    provider.setAwarenessField('focusId', null);
    provider.setAwarenessField('updatedAt', Date.now());

    const map = provider.document.getMap('state') as unknown as MapLike;
    const mapObserver = () => {
      this.options.onDocChanged?.(seed.docName);
    };
    map.observe(mapObserver);
    this.mapObservers.set(seed.docName, mapObserver);

    if (provider.awareness) {
      const awarenessObserver = () => this.options.onPresenceChanged?.();
      provider.awareness.on('change', awarenessObserver);
      this.awarenessObservers.set(seed.docName, awarenessObserver);
    }

    this.rooms.set(seed.docName, {
      provider,
      map,
      seed: structuredClone(seed.initialValue),
    });
  }

  disconnectAll(): void {
    for (const [docName, room] of this.rooms.entries()) {
      const mapObserver = this.mapObservers.get(docName);
      if (mapObserver) {
        room.map.unobserve(mapObserver);
      }

      const awarenessObserver = this.awarenessObservers.get(docName);
      if (awarenessObserver && room.provider.awareness) {
        room.provider.awareness.off('change', awarenessObserver);
      }

      room.provider.destroy();
    }

    this.rooms.clear();
    this.mapObservers.clear();
    this.awarenessObservers.clear();
    this.publishSignatures.clear();
    this.syncedRooms.clear();
  }

  setFocus(docName: string, focusId: string | null): void {
    const room = this.rooms.get(docName);
    if (!room) {
      return;
    }

    room.provider.setAwarenessField('user', this.options.user);
    room.provider.setAwarenessField('focusId', focusId);
    room.provider.setAwarenessField('updatedAt', Date.now());
  }

  setCatalogCursor(
    docName: string,
    cursor: {
      fieldId: string;
      position: number | null;
    } | null,
  ): void {
    const room = this.rooms.get(docName);
    if (!room) {
      return;
    }

    room.provider.setAwarenessField('user', this.options.user);
    room.provider.setAwarenessField('catalogCursor', cursor);
    room.provider.setAwarenessField('updatedAt', Date.now());
  }

  getDoc<T extends JsonMapValue>(docName: string): T | null {
    const room = this.rooms.get(docName);
    if (!room) {
      return null;
    }

    const value = room.map.get('json') as JsonMapValue | null | undefined;
    if (!value) {
      return null;
    }

    return structuredClone(value) as T;
  }

  publishDoc(docName: string, value: JsonMapValue): void {
    const room = this.rooms.get(docName);
    if (!room || !this.syncedRooms.has(docName)) {
      return;
    }

    const signature = JSON.stringify(value);
    if (this.publishSignatures.get(docName) === signature) {
      return;
    }

    this.publishSignatures.set(docName, signature);
    room.map.set('json', structuredClone(value));
  }

  getProvider(docName: string): HocuspocusProvider | null {
    return this.rooms.get(docName)?.provider ?? null;
  }

  getPresenceByDoc(): Record<string, PresenceState[]> {
    const byDoc: Record<string, PresenceState[]> = {};

    for (const [docName, room] of this.rooms.entries()) {
      const awareness = room.provider.awareness;
      if (!awareness) {
        byDoc[docName] = [];
        continue;
      }

      const states = Array.from(awareness.getStates().entries());
      byDoc[docName] = states
        .map(([clientId, raw]) => {
          const user = raw?.user as CollabUser | undefined;
          if (!user || !user.id || !user.name) {
            return null;
          }

          return {
            clientId,
            isLocal: clientId === awareness.clientID,
            user,
            focusId: typeof raw?.focusId === 'string' ? raw.focusId : null,
            catalogCursor:
              raw?.catalogCursor && typeof raw.catalogCursor.fieldId === 'string'
                ? {
                    fieldId: raw.catalogCursor.fieldId,
                    position: typeof raw.catalogCursor.position === 'number' ? raw.catalogCursor.position : null,
                  }
                : null,
          } satisfies PresenceState;
        })
        .filter((state): state is PresenceState => state != null);
    }

    return byDoc;
  }
}

export function buildCollabSeeds(input: {
  manifestsByCollectionId: Record<string, CollectionManifestDoc>;
  seriesDocs: Record<string, SeriesDoc>;
  manifestDocNameByCollectionId: Record<string, string>;
}): DocSeed[] {
  const seeds: DocSeed[] = [];

  for (const [collectionId, manifest] of Object.entries(input.manifestsByCollectionId)) {
    const roomName = input.manifestDocNameByCollectionId[collectionId];
    if (!roomName) {
      continue;
    }
    seeds.push({
      docName: roomName,
      initialValue: structuredClone(manifest),
    });
  }

  for (const [docName, seriesDoc] of Object.entries(input.seriesDocs)) {
    seeds.push({
      docName,
      initialValue: structuredClone(seriesDoc),
    });
  }

  return seeds;
}
