import type { UUID } from './types';

export type AwarenessUser = {
  id: string;
  name: string;
  color: string;
};

export type AwarenessState = {
  user: AwarenessUser;
  focusId: UUID | null;
  updatedAt: number;
};

export class AwarenessStore {
  private readonly docs = new Map<string, Map<string, AwarenessState>>();

  set(docName: string, state: AwarenessState): void {
    let docMap = this.docs.get(docName);
    if (!docMap) {
      docMap = new Map<string, AwarenessState>();
      this.docs.set(docName, docMap);
    }

    docMap.set(state.user.id, structuredClone(state));
  }

  remove(docName: string, userId: string): void {
    const docMap = this.docs.get(docName);
    if (!docMap) {
      return;
    }

    docMap.delete(userId);
    if (docMap.size === 0) {
      this.docs.delete(docName);
    }
  }

  list(docName: string): AwarenessState[] {
    const docMap = this.docs.get(docName);
    if (!docMap) {
      return [];
    }

    return [...docMap.values()].map((state) => structuredClone(state));
  }

  listCollectionPresence(docNamePrefix: string): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const [docName, states] of this.docs.entries()) {
      if (!docName.startsWith(docNamePrefix)) {
        continue;
      }
      counts[docName] = states.size;
    }

    return counts;
  }

  focusChips(docName: string): Record<string, AwarenessUser[]> {
    const chips: Record<string, AwarenessUser[]> = {};

    for (const state of this.list(docName)) {
      if (!state.focusId) {
        continue;
      }
      if (!chips[state.focusId]) {
        chips[state.focusId] = [];
      }
      chips[state.focusId].push(state.user);
    }

    return chips;
  }
}
