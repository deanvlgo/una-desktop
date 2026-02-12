export type WorkflowStatus =
  | 'describe_started'
  | 'refine_in_progress'
  | 'submitted_in_una'
  | 'finalized';

export type OrgCollectionIndexEntry = {
  collectionId: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  workflowStatus: WorkflowStatus;
  submittedAt: string | null;
  lastEditedBy?: string;
  isArchived?: boolean;
  sourceObjectId?: string;
  entryType?: 'standard' | 'guided' | 'post_hoc';
};

export function orgCollectionsDocName(orgId: string) {
  return `org:${orgId}:collections`;
}

export function collectionManifestDocName(orgId: string, collectionId: string) {
  return `collection:${orgId}:${collectionId}`;
}

export function seriesDocName(orgId: string, collectionId: string, seriesId: string) {
  return `series:${orgId}:${collectionId}:${seriesId}`;
}
