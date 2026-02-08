// Authoritative contracts for the Collaborative Archival Editor.
// Derived from PRD Addendum B.

export type UUID = string;
export type EpochMs = number;

export type PMDoc = {
  type: "doc";
  content: PMNode[];
};

export type PMNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
};

export type PMMark = {
  type: string;
  attrs?: Record<string, any>;
};

export type NodeType =
  | "collectionManifest"
  | "collectionMeta"
  | "seriesRef"
  | "series"
  | "seriesOps"
  | "seriesBody"
  | "subseries"
  | "file"
  | "item"
  | "itemFields"
  | "itemBody"
  | "field"
  | "fieldGroup"
  | "suggestion_delete"
  | "suggestion_block"
  | "paragraph"
  | "text"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "image";

export type CollectionManifestDoc = {
  type: "doc";
  content: [CollectionManifestNode];
};

export type CollectionManifestNode = {
  type: "collectionManifest";
  attrs: {
    collectionId: UUID;
    title: string;
    dates?: string;
  };
  content: [CollectionMetaNode, ...SeriesRefNode[]];
};

export type CollectionMetaNode = {
  type: "collectionMeta";
  content?: PMNode[];
};

export type SeriesRefNode = {
  type: "seriesRef";
  attrs: {
    seriesId: UUID;
    title: string;
    order: number;
    docName: string;
  };
};

export type SeriesDoc = {
  type: "doc";
  content: [SeriesNode];
};

export type SeriesNode = {
  type: "series";
  attrs: {
    id: UUID;
    title?: string;
    dates?: string;
    refCode?: string;
    [key: string]: string | undefined;
  };
  content: PMNode[];
};

export type SeriesOpsNode = {
  type: "seriesOps";
  content?: SuggestionBlockNode[];
};

export type SeriesBodyNode = {
  type: "seriesBody";
  content?: PMNode[];
};

export type SubseriesNode = {
  type: "subseries";
  attrs: {
    id: UUID;
    title?: string;
    dates?: string;
    refCode?: string;
    [key: string]: string | undefined;
  };
  content: Array<SubseriesNode | FileNode>;
};

export type FileNode = {
  type: "file";
  attrs: {
    id: UUID;
    title?: string;
    dates?: string;
    refCode?: string;
    [key: string]: string | undefined;
  };
  content: ItemNode[];
};

export type ItemType = "photograph" | "document" | "object";

export type ItemNode = {
  type: "item";
  attrs: {
    id: UUID;
    itemType: ItemType;
  };
  content: [ItemFieldsNode, ItemBodyNode];
};

export type ItemFieldsNode = {
  type: "itemFields";
  content?: Array<FieldNode | FieldGroupNode | SuggestionBlockNode>;
};

export type ItemBodyNode = {
  type: "itemBody";
  content?: PMNode[];
};

export type ValueType = "text" | "date" | "number" | "select" | "boolean";

export type FieldNode = {
  type: "field";
  attrs: {
    id: UUID;
    key: string;
    valueType: ValueType;
    value: string | number | boolean | null;
  };
};

export type FieldGroupNode = {
  type: "fieldGroup";
  attrs: {
    id: UUID;
    groupKey: string;
  };
  content: FieldNode[];
};

export type SuggestionInsertMark = {
  type: "suggestion_insert";
  attrs: {
    sid: UUID;
    author: string;
    createdAt: EpochMs;
    groupId?: UUID;
  };
};

export type SuggestionDeleteNode = {
  type: "suggestion_delete";
  attrs: {
    sid: UUID;
    author: string;
    createdAt: EpochMs;
    text: string;
    groupId?: UUID;
  };
};

export type SuggestionKind =
  | "CREATE_ITEM"
  | "SET_FIELD"
  | "REORDER_SIBLING"
  | "MOVE_SUBTREE_CROSS_SERIES";

export type SuggestionBlockNode = {
  type: "suggestion_block";
  attrs: {
    sid: UUID;
    kind: SuggestionKind;
    payload:
      | CreateItemPayload
      | SetFieldPayload
      | ReorderSiblingPayload
      | MoveCrossSeriesPayload;
    author: string;
    createdAt: EpochMs;
    groupId?: UUID;
  };
};

export type CreateItemPayload = {
  parentFileId: UUID;
  itemType: ItemType;
  initialFields?: Record<string, any>;
  initialBodyText?: string;
  insert?: { kind: "append" } | { kind: "before" | "after"; siblingId: UUID };
};

export type SetFieldPayload = {
  itemId: UUID;
  key: string;
  valueType: ValueType;
  value: string | number | boolean | null;
};

export type ReorderSiblingPayload = {
  parentId: UUID;
  nodeId: UUID;
  targetSiblingId: UUID;
  placement: "before" | "after";
};

export type MoveCrossSeriesPayload = {
  source: { seriesId: UUID; docName: string };
  target: { seriesId: UUID; docName: string };
  subtreeRootId: UUID;
  targetParentId: UUID;
  placement:
    | { kind: "append" }
    | { kind: "before"; siblingId: UUID }
    | { kind: "after"; siblingId: UUID };
};

export type AgentActionLogRecord = {
  opId: UUID;
  userId: string;
  createdAt: EpochMs;
  docNames: string[];
  suggestionIds: UUID[];
  groupId?: UUID;
  promptSummary?: string;
  result: "ok" | "failed";
  errorMessage?: string;
};
