import type { AgentActionLogRecord } from './types';

export type AgentActionFilter = {
  docName?: string;
  userId?: string;
  result?: AgentActionLogRecord['result'];
};

export class InMemoryAgentActionLog {
  private readonly records: AgentActionLogRecord[] = [];

  append(record: AgentActionLogRecord): void {
    this.records.push(structuredClone(record));
  }

  list(filter?: AgentActionFilter): AgentActionLogRecord[] {
    const output = this.records.filter((record) => {
      if (filter?.docName && !record.docNames.includes(filter.docName)) {
        return false;
      }
      if (filter?.userId && record.userId !== filter.userId) {
        return false;
      }
      if (filter?.result && record.result !== filter.result) {
        return false;
      }
      return true;
    });

    return output.map((record) => structuredClone(record));
  }

  clear(): void {
    this.records.length = 0;
  }
}
