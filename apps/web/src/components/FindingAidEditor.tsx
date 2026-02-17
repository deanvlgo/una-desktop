import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type AnyExtension, JSONContent, Mark, Node, mergeAttributes } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Heading from '@tiptap/extension-heading';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { PAGE_SIZES, PaginationPlus } from 'tiptap-pagination-plus';

import type { PMNode } from '../../../../src/contracts/types';
import { formatHierarchyNodeHeading, getHierarchyLevelLabel } from '../lib/hierarchyLabels';
import { userInitials } from '../lib/user';

type HierarchyLevel = 'series' | 'subseries' | 'file' | 'item';

export type HierarchyHeading = {
  id: string;
  level: HierarchyLevel;
  title: string;
  depth: number;
  pathLabel: string;
};

type FindingAidEditorProps = {
  content: PMNode[];
  hierarchyHeadings: HierarchyHeading[];
  focusedHierarchyId?: string;
  focusRequestKey?: number;
  onHierarchyTitleChange?: (hierarchyId: string, title: string) => void;
  collaboration?: {
    provider: HocuspocusProvider;
    user: { name: string; color: string; avatar?: string };
  } | null;
  onCursorHierarchyFocus?: (hierarchyId: string) => void;
  onChange: (nextContent: PMNode[]) => void;
};

const SuggestionInsertMark = Mark.create({
  name: 'suggestion_insert',

  addAttributes() {
    return {
      sid: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sid'),
        renderHTML: (attrs) => (attrs.sid ? { 'data-sid': String(attrs.sid) } : {}),
      },
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-author'),
        renderHTML: (attrs) => (attrs.author ? { 'data-author': String(attrs.author) } : {}),
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-created-at');
          return value == null ? null : Number(value);
        },
        renderHTML: (attrs) =>
          attrs.createdAt == null ? {} : { 'data-created-at': String(attrs.createdAt) },
      },
      groupId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-group-id'),
        renderHTML: (attrs) =>
          attrs.groupId == null ? {} : { 'data-group-id': String(attrs.groupId) },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-suggestion-insert="1"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-suggestion-insert': '1', class: 'pm-suggestion-insert' }, HTMLAttributes),
      0,
    ];
  },
});

const SuggestionDeleteNode = Node.create({
  name: 'suggestion_delete',
  inline: true,
  group: 'inline',
  atom: true,

  addAttributes() {
    return {
      sid: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sid'),
        renderHTML: (attrs) => (attrs.sid ? { 'data-sid': String(attrs.sid) } : {}),
      },
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-author'),
        renderHTML: (attrs) => (attrs.author ? { 'data-author': String(attrs.author) } : {}),
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-created-at');
          return value == null ? null : Number(value);
        },
        renderHTML: (attrs) =>
          attrs.createdAt == null ? {} : { 'data-created-at': String(attrs.createdAt) },
      },
      text: {
        default: '',
        parseHTML: (element) => element.textContent ?? '',
      },
      groupId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-group-id'),
        renderHTML: (attrs) =>
          attrs.groupId == null ? {} : { 'data-group-id': String(attrs.groupId) },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-suggestion-delete="1"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-suggestion-delete': '1', class: 'pm-suggestion-delete' },
        HTMLAttributes,
      ),
      String(HTMLAttributes.text ?? ''),
    ];
  },

  renderText({ node }) {
    return String(node.attrs?.text ?? '');
  },
});

const FindingAidHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      hierarchyId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-hierarchy-id'),
        renderHTML: (attrs) =>
          attrs.hierarchyId == null ? {} : { 'data-hierarchy-id': String(attrs.hierarchyId) },
      },
      hierarchyDepth: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-hierarchy-depth');
          return value == null ? null : Number(value);
        },
        renderHTML: (attrs) =>
          attrs.hierarchyDepth == null
            ? {}
            : { 'data-hierarchy-depth': String(attrs.hierarchyDepth) },
      },
      hierarchyLevel: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-hierarchy-level'),
        renderHTML: (attrs) =>
          attrs.hierarchyLevel == null
            ? {}
            : { 'data-hierarchy-level': String(attrs.hierarchyLevel) },
      },
    };
  },
});

function buildHierarchyHeadingNodes(headings: HierarchyHeading[]): PMNode[] {
  const nodes: PMNode[] = [];

  for (const heading of headings) {
    const level = Math.max(1, Math.min(heading.depth + 1, 3)) as 1 | 2 | 3;

    nodes.push({
      type: 'heading',
      attrs: {
        level,
        hierarchyId: heading.id,
        hierarchyDepth: heading.depth,
        hierarchyLevel: heading.level,
      },
      content: [
        {
          type: 'text',
          text: formatHierarchyNodeHeading(heading.level, heading.pathLabel, heading.title),
        },
      ],
    });
  }

  return nodes;
}

function normalizeHierarchySectionContent(content: PMNode[], hierarchyHeadings: HierarchyHeading[]): PMNode[] {
  if (hierarchyHeadings.length === 0) {
    return content.length > 0 ? structuredClone(content) : [{ type: 'paragraph' }];
  }

  const sections = new Map<string, PMNode[]>();
  const leading: PMNode[] = [];
  let activeId: string | null = null;

  for (const node of content) {
    if (isHierarchyHeadingNode(node)) {
      activeId = String(node.attrs?.hierarchyId);
      if (!sections.has(activeId)) {
        sections.set(activeId, []);
      }
      continue;
    }

    if (!activeId) {
      leading.push(structuredClone(node));
      continue;
    }

    const section = sections.get(activeId) ?? [];
    section.push(structuredClone(node));
    sections.set(activeId, section);
  }

  if (leading.length > 0) {
    const firstId = hierarchyHeadings[0]?.id;
    if (firstId) {
      const firstSection = sections.get(firstId) ?? [];
      sections.set(firstId, [...leading, ...firstSection]);
    }
  }

  const normalized: PMNode[] = [];
  const headingNodes = buildHierarchyHeadingNodes(hierarchyHeadings);

  for (let index = 0; index < hierarchyHeadings.length; index += 1) {
    const heading = hierarchyHeadings[index];
    const headingNode = headingNodes[index];
    if (headingNode) {
      normalized.push(headingNode);
    }

    const sectionNodes = sections.get(heading.id) ?? [];
    for (const node of sectionNodes) {
      normalized.push(structuredClone(node));
    }
  }

  return normalized;
}

function contentToDoc(content: PMNode[], hierarchyHeadings: HierarchyHeading[]): JSONContent {
  const normalized = normalizeHierarchySectionContent(content, hierarchyHeadings);

  return {
    type: 'doc',
    content: normalized as unknown as JSONContent[],
  };
}

export function buildFindingAidDocJson(content: PMNode[], hierarchyHeadings: HierarchyHeading[]): JSONContent {
  return contentToDoc(content, hierarchyHeadings);
}

function readContentFromEditor(json: JSONContent): PMNode[] {
  if (!Array.isArray(json.content)) {
    return [];
  }

  const nodes = json.content as unknown as PMNode[];
  return flattenPageLayoutNodes(nodes);
}

function flattenPageLayoutNodes(nodes: PMNode[]): PMNode[] {
  const flattened: PMNode[] = [];
  const pageContentSignatures = new Set<string>();

  for (const node of nodes) {
    if (node.type === 'header-footer' || node.type === 'pageHeader' || node.type === 'pageFooter') {
      continue;
    }

    if (node.type === 'page' || node.type === 'body' || node.type === 'pageBody' || node.type === 'pageContent') {
      const nested = flattenPageLayoutNodes(Array.isArray(node.content) ? (node.content as PMNode[]) : []);
      const signature = JSON.stringify(nested);
      if (signature.length > 2) {
        if (pageContentSignatures.has(signature)) {
          continue;
        }
        pageContentSignatures.add(signature);
      }
      for (const child of nested) {
        flattened.push(structuredClone(child));
      }
      continue;
    }

    flattened.push(structuredClone(node));
  }

  return flattened;
}

function isHierarchyHeadingNode(node: PMNode): boolean {
  return node.type === 'heading' && node.attrs?.hierarchyId != null;
}

function readNodeText(node: PMNode): string {
  if (node.type === 'text') {
    return String(node.text ?? '');
  }

  return (node.content ?? []).map((child) => readNodeText(child)).join('');
}

function parseDisplayHeadingToTitle(displayText: string, heading: HierarchyHeading): string | null {
  const normalizedDisplay = displayText.trim();
  if (normalizedDisplay.length === 0) {
    return null;
  }

  const prefix = `${getHierarchyLevelLabel(heading.level)} ${heading.pathLabel.trim().length > 0 ? heading.pathLabel.trim() : 'I'} - `;
  if (normalizedDisplay.startsWith(prefix)) {
    const stripped = normalizedDisplay.slice(prefix.length).trim();
    return stripped.length > 0 ? stripped : null;
  }

  const generic = normalizedDisplay.match(/^[A-Za-z]+\s+[IVXLCDM]+\s*-\s*(.+)$/i);
  if (generic?.[1]) {
    const stripped = generic[1].trim();
    return stripped.length > 0 ? stripped : null;
  }

  return normalizedDisplay;
}

function collectHierarchyTitlePatches(content: PMNode[], hierarchyHeadings: HierarchyHeading[]): Array<{ id: string; title: string }> {
  const headingById = new Map<string, HierarchyHeading>();
  for (const heading of hierarchyHeadings) {
    headingById.set(heading.id, heading);
  }

  const patches = new Map<string, string>();
  for (const node of content) {
    if (!isHierarchyHeadingNode(node)) {
      continue;
    }

    const hierarchyId = String(node.attrs?.hierarchyId ?? '');
    const heading = headingById.get(hierarchyId);
    if (!heading) {
      continue;
    }

    const displayText = readNodeText(node).trim();
    if (displayText.length === 0) {
      continue;
    }

    const expected = formatHierarchyNodeHeading(heading.level, heading.pathLabel, heading.title);
    if (displayText === expected) {
      continue;
    }

    const parsedTitle = parseDisplayHeadingToTitle(displayText, heading);
    if (!parsedTitle || parsedTitle === heading.title.trim()) {
      continue;
    }

    patches.set(hierarchyId, parsedTitle);
  }

  return Array.from(patches.entries()).map(([id, title]) => ({ id, title }));
}

function isSameHierarchyShape(previous: HierarchyHeading[], next: HierarchyHeading[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const a = previous[index];
    const b = next[index];
    if (!a || !b) {
      return false;
    }

    if (a.id !== b.id || a.level !== b.level || a.depth !== b.depth || a.pathLabel !== b.pathLabel) {
      return false;
    }
  }

  return true;
}

function applyHierarchyHeadingTitlesToEditor(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  hierarchyHeadings: HierarchyHeading[],
): boolean {
  const headingById = new Map<string, HierarchyHeading>();
  for (const heading of hierarchyHeadings) {
    headingById.set(heading.id, heading);
  }

  const activeHeadingHierarchyId =
    editor.isFocused &&
    editor.state.selection.$from.parent.type.name === 'heading' &&
    editor.state.selection.$from.parent.attrs?.hierarchyId != null
      ? String(editor.state.selection.$from.parent.attrs.hierarchyId)
      : null;

  const patches: Array<{ from: number; to: number; text: string }> = [];

  let tr = editor.state.tr;
  let changed = false;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading' || node.attrs?.hierarchyId == null) {
      return true;
    }

    const hierarchyId = String(node.attrs.hierarchyId);
    const heading = headingById.get(hierarchyId);
    if (!heading) {
      return true;
    }
    if (activeHeadingHierarchyId && hierarchyId === activeHeadingHierarchyId) {
      return true;
    }

    const expected = formatHierarchyNodeHeading(heading.level, heading.pathLabel, heading.title);
    const current = node.textContent ?? '';
    if (current === expected) {
      return true;
    }

    patches.push({
      from: pos + 1,
      to: pos + node.nodeSize - 1,
      text: expected,
    });
    return true;
  });

  for (const patch of patches) {
    const from = tr.mapping.map(patch.from);
    const to = tr.mapping.map(patch.to);
    tr = tr.insertText(patch.text, from, to);
    changed = true;
  }

  if (changed) {
    const mappedSelection = editor.state.selection.map(tr.doc, tr.mapping);
    if (mappedSelection.$anchor.parent.inlineContent && mappedSelection.$head.parent.inlineContent) {
      tr = tr.setSelection(mappedSelection);
    }
    editor.view.dispatch(tr);
  }

  return changed;
}

function findFirstInlinePosition(doc: NonNullable<ReturnType<typeof useEditor>>['state']['doc']): number | null {
  let inlinePos: number | null = null;
  doc.descendants((node, pos) => {
    if (node.isTextblock && node.inlineContent) {
      inlinePos = pos + 1;
      return false;
    }
    return true;
  });
  return inlinePos;
}

function removeHeadingAtSelection(editor: ReturnType<typeof useEditor>): boolean {
  if (!editor) {
    return false;
  }

  const { doc, selection } = editor.state;
  const anchorPos = selection.$from.pos;
  let targetPos: number | null = null;
  let targetNodeSize = 0;

  doc.nodesBetween(0, anchorPos, (node, pos) => {
    if (node.type.name === 'heading' && !node.attrs?.hierarchyId) {
      targetPos = pos;
      targetNodeSize = node.nodeSize;
    }
  });

  if (targetPos == null || targetNodeSize <= 0) {
    return false;
  }

  editor
    .chain()
    .focus()
    .deleteRange({ from: targetPos, to: targetPos + targetNodeSize })
    .run();
  return true;
}

function readHierarchyIdAtSelection(editor: ReturnType<typeof useEditor>): string | null {
  if (!editor) {
    return null;
  }

  const { doc, selection } = editor.state;
  const anchorPos = selection.$from.pos;
  let lastSeenHierarchyId: string | null = null;

  doc.nodesBetween(0, anchorPos, (node) => {
    if (node.type.name === 'heading' && node.attrs?.hierarchyId != null) {
      lastSeenHierarchyId = String(node.attrs.hierarchyId);
    }
  });

  if (lastSeenHierarchyId) {
    return lastSeenHierarchyId;
  }

  let firstHierarchyId: string | null = null;
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs?.hierarchyId != null) {
      firstHierarchyId = String(node.attrs.hierarchyId);
      return false;
    }
    return true;
  });

  return firstHierarchyId;
}

function EditorActionButton({
  children,
  active,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={active ? 'finding-aid__action is-active' : 'finding-aid__action'}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export function FindingAidEditor({
  content,
  hierarchyHeadings,
  focusedHierarchyId,
  focusRequestKey = 0,
  onHierarchyTitleChange,
  collaboration = null,
  onCursorHierarchyFocus,
  onChange,
}: FindingAidEditorProps) {
  const isApplyingRef = useRef(false);
  const hierarchyHeadingsRef = useRef(hierarchyHeadings);
  const onCursorHierarchyFocusRef = useRef(onCursorHierarchyFocus);
  const onHierarchyTitleChangeRef = useRef(onHierarchyTitleChange);
  const lastReportedHierarchyIdRef = useRef<string | null>(null);
  const lastHandledFocusRequestKeyRef = useRef(0);
  const lastPushedHeadingTitlesRef = useRef<Record<string, string>>({});
  const onChangeRef = useRef(onChange);
  const contentSignature = useMemo(() => JSON.stringify(content), [content]);
  const hierarchySignature = useMemo(() => JSON.stringify(hierarchyHeadings), [hierarchyHeadings]);
  const collaborationProvider = collaboration?.provider ?? null;
  const collaborationUser = collaboration?.user ?? null;
  const collaborationEnabled = Boolean(collaborationProvider && collaborationUser);
  const syncedContentSignatureRef = useRef(contentSignature);
  const syncedHierarchySignatureRef = useRef(hierarchySignature);
  const syncedHierarchyHeadingsRef = useRef(hierarchyHeadings);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const pendingSetContentFrameRef = useRef<number | null>(null);
  const [sectionDepth, setSectionDepth] = useState(0);

  const clearPendingSetContent = useCallback(() => {
    if (pendingSetContentFrameRef.current != null) {
      window.cancelAnimationFrame(pendingSetContentFrameRef.current);
      pendingSetContentFrameRef.current = null;
    }
  }, []);

  const applyContentWhenViewReady = useCallback(
    (nextDoc: JSONContent) => {
      clearPendingSetContent();
      let attempts = 0;

      const run = () => {
        attempts += 1;

        const activeEditor = editorRef.current;
        if (!activeEditor || activeEditor.isDestroyed) {
          return;
        }

        let isViewReady = false;
        try {
          const view = (activeEditor as unknown as { view?: { dom?: Element } }).view;
          isViewReady = Boolean(view?.dom && (view.dom as Element).isConnected);
          if (!isViewReady) {
            throw new Error('EDITOR_VIEW_NOT_READY');
          }

          isApplyingRef.current = true;
          activeEditor.commands.setContent(nextDoc, false);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            (message.includes('editor view is not available') || message.includes('EDITOR_VIEW_NOT_READY')) &&
            attempts < 24
          ) {
            pendingSetContentFrameRef.current = window.requestAnimationFrame(run);
            return;
          }
          console.error('Failed to set editor content', error);
        } finally {
          isApplyingRef.current = false;
        }
      };

      pendingSetContentFrameRef.current = window.requestAnimationFrame(run);
    },
    [clearPendingSetContent],
  );

  useEffect(() => clearPendingSetContent, [clearPendingSetContent]);

  useEffect(() => {
    hierarchyHeadingsRef.current = hierarchyHeadings;
    onCursorHierarchyFocusRef.current = onCursorHierarchyFocus;
    onHierarchyTitleChangeRef.current = onHierarchyTitleChange;
    onChangeRef.current = onChange;
    const titleMap: Record<string, string> = {};
    for (const heading of hierarchyHeadings) {
      titleMap[heading.id] = heading.title.trim();
    }
    lastPushedHeadingTitlesRef.current = titleMap;
  }, [hierarchyHeadings, onCursorHierarchyFocus, onHierarchyTitleChange, onChange]);

  const editor = useEditor({
    extensions: (() => {
      const base = [
        StarterKit.configure({
          heading: false,
          link: false,
          underline: false,
          undoRedo: collaborationEnabled ? false : undefined,
        }),
        FindingAidHeading.configure({ levels: [1, 2, 3] }),
        Underline,
        Link.configure({
          openOnClick: false,
        }),
        SuggestionInsertMark,
        SuggestionDeleteNode,
        PaginationPlus.configure({
          pageHeight: PAGE_SIZES.LETTER.pageHeight,
          pageWidth: PAGE_SIZES.LETTER.pageWidth,
          pageGap: 20,
          pageBreakBackground: '#e8e8e6',
          marginTop: PAGE_SIZES.LETTER.marginTop,
          marginRight: PAGE_SIZES.LETTER.marginRight,
          marginBottom: PAGE_SIZES.LETTER.marginBottom,
          marginLeft: PAGE_SIZES.LETTER.marginLeft,
        }) as unknown as AnyExtension,
      ];

      if (!collaborationEnabled || !collaborationProvider || !collaborationUser) {
        return base;
      }

      return [
        ...base,
        Collaboration.configure({
          document: collaborationProvider.document,
          field: 'tiptap',
        }),
        CollaborationCaret.configure({
          provider: collaborationProvider,
          user: collaborationUser,
          render: (user: { name?: string; avatar?: string }) => {
            const caret = document.createElement('span');
            caret.classList.add('collaboration-cursor__caret');

            const label = document.createElement('span');
            label.classList.add('collaboration-cursor__label');

            const avatar = typeof user.avatar === 'string' ? user.avatar : '';
            if (avatar.length > 0) {
              const avatarImage = document.createElement('img');
              avatarImage.classList.add('collaboration-cursor__avatar');
              avatarImage.src = avatar;
              avatarImage.alt = `${user.name} avatar`;
              label.appendChild(avatarImage);
            } else {
              const initials = document.createElement('span');
              initials.classList.add('collaboration-cursor__avatar-fallback');
              initials.textContent = userInitials(String(user.name ?? ''));
              label.appendChild(initials);
            }

            const name = document.createElement('span');
            name.classList.add('collaboration-cursor__name');
            name.textContent = String(user.name ?? '');
            label.appendChild(name);
            caret.appendChild(label);

            return caret;
          },
        }),
      ];
    })(),
    content: contentToDoc(content, hierarchyHeadings),
    editorProps: {
      attributes: {
        class: 'finding-aid__prose finding-aid__prose--paginated',
      },
    },
    onUpdate: ({ editor: current }) => {
      if (isApplyingRef.current) {
        return;
      }

      const fullContent = readContentFromEditor(current.getJSON());
      const headingPatches = collectHierarchyTitlePatches(fullContent, hierarchyHeadingsRef.current);
      for (const patch of headingPatches) {
        if (lastPushedHeadingTitlesRef.current[patch.id] === patch.title) {
          continue;
        }
        lastPushedHeadingTitlesRef.current[patch.id] = patch.title;
        onHierarchyTitleChangeRef.current?.(patch.id, patch.title);
      }

      const normalized = normalizeHierarchySectionContent(fullContent, hierarchyHeadingsRef.current);
      const nextSignature = JSON.stringify(normalized);
      if (nextSignature === syncedContentSignatureRef.current) {
        return;
      }

      syncedContentSignatureRef.current = nextSignature;
      onChangeRef.current(normalized);
    },
    onSelectionUpdate: ({ editor: current }) => {
      if (isApplyingRef.current) {
        return;
      }

      if (!current.isFocused) {
        return;
      }

      const hierarchyId = readHierarchyIdAtSelection(current);
      if (!hierarchyId || lastReportedHierarchyIdRef.current === hierarchyId) {
        return;
      }

      lastReportedHierarchyIdRef.current = hierarchyId;
      onCursorHierarchyFocusRef.current?.(hierarchyId);
    },
  }, [collaborationEnabled, collaborationProvider, collaborationUser?.avatar, collaborationUser?.name, collaborationUser?.color]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const shouldSeedEmptyCollabDoc =
      collaborationEnabled && editor.isEmpty && (content.length > 0 || hierarchyHeadings.length > 0);

    if (shouldSeedEmptyCollabDoc) {
      applyContentWhenViewReady(contentToDoc(content, hierarchyHeadings));

      syncedContentSignatureRef.current = contentSignature;
      syncedHierarchySignatureRef.current = hierarchySignature;
      return;
    }

    const contentChanged = contentSignature !== syncedContentSignatureRef.current;
    const hierarchyChanged = hierarchySignature !== syncedHierarchySignatureRef.current;
    const shapeChanged = !isSameHierarchyShape(syncedHierarchyHeadingsRef.current, hierarchyHeadings);

    if (!contentChanged && !hierarchyChanged) {
      if (collaborationEnabled) {
        const editorContent = normalizeHierarchySectionContent(
          readContentFromEditor(editor.getJSON()),
          hierarchyHeadings,
        );
        const editorContentSignature = JSON.stringify(editorContent);
        const shouldReconcileFromCanonical =
          !editor.isFocused &&
          editorContentSignature !== contentSignature;

        if (shouldReconcileFromCanonical) {
          applyContentWhenViewReady(contentToDoc(content, hierarchyHeadings));

          syncedContentSignatureRef.current = contentSignature;
          syncedHierarchySignatureRef.current = hierarchySignature;
          syncedHierarchyHeadingsRef.current = hierarchyHeadings;
        }
      }
      return;
    }

    if (hierarchyChanged && !contentChanged && !shapeChanged) {
      isApplyingRef.current = true;
      applyHierarchyHeadingTitlesToEditor(editor, hierarchyHeadings);
      isApplyingRef.current = false;

      syncedContentSignatureRef.current = contentSignature;
      syncedHierarchySignatureRef.current = hierarchySignature;
      syncedHierarchyHeadingsRef.current = hierarchyHeadings;
      return;
    }

    // In collaborative mode, desktop-to-desktop edits arrive via TipTap/Yjs (`tiptap` field),
    // while mobile edits arrive through canonical `state.json`. If the editor already matches
    // incoming content, skip. Otherwise apply content so mobile-originated edits render.
    if (collaborationEnabled && !hierarchyChanged) {
      const editorContent = readContentFromEditor(editor.getJSON());
      const editorContentSignature = JSON.stringify(editorContent);
      if (editorContentSignature === contentSignature) {
        syncedContentSignatureRef.current = contentSignature;
        syncedHierarchySignatureRef.current = hierarchySignature;
        syncedHierarchyHeadingsRef.current = hierarchyHeadings;
        return;
      }
    }

    applyContentWhenViewReady(contentToDoc(content, hierarchyHeadings));

    syncedContentSignatureRef.current = contentSignature;
    syncedHierarchySignatureRef.current = hierarchySignature;
    syncedHierarchyHeadingsRef.current = hierarchyHeadings;
  }, [applyContentWhenViewReady, collaborationEnabled, content, contentSignature, editor, hierarchyHeadings, hierarchySignature]);

  useEffect(() => {
    if (!editor || !focusedHierarchyId) {
      return;
    }

    if (focusRequestKey <= 0 || focusRequestKey <= lastHandledFocusRequestKeyRef.current) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const tryScrollToHeading = () => {
      if (cancelled) {
        return;
      }

      let headingPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && String(node.attrs?.hierarchyId ?? '') === focusedHierarchyId) {
          headingPos = pos;
          return false;
        }
        return true;
      });

      if (headingPos != null) {
        lastHandledFocusRequestKeyRef.current = focusRequestKey;
        lastReportedHierarchyIdRef.current = focusedHierarchyId;
        const targetPos = headingPos + 1;
        const maxPos = Math.max(1, editor.state.doc.content.size);
        const safePos = Math.max(1, Math.min(targetPos, maxPos));
        const resolved = editor.state.doc.resolve(safePos);
        if (resolved.parent.inlineContent) {
          editor.chain().focus(safePos).scrollIntoView().run();
        } else {
          const fallbackPos = findFirstInlinePosition(editor.state.doc);
          if (fallbackPos != null) {
            editor.chain().focus(fallbackPos).scrollIntoView().run();
          }
        }
        return;
      }

      attempts += 1;
      if (attempts < 60) {
        requestAnimationFrame(tryScrollToHeading);
      }
    };

    tryScrollToHeading();

    return () => {
      cancelled = true;
    };
  }, [editor, focusedHierarchyId, focusRequestKey, hierarchySignature]);

  const setLink = useCallback(() => {
    if (!editor) {
      return;
    }

    const existing = String(editor.getAttributes('link').href ?? '');
    const next = window.prompt('Enter a URL', existing);
    if (next == null) {
      return;
    }

    if (next.trim().length === 0) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: next.trim() }).run();
  }, [editor]);

  const insertSectionAtDepth = useCallback(
    (depth: number) => {
      if (!editor) {
        return;
      }

      const level = Math.max(1, Math.min(depth + 1, 3)) as 1 | 2 | 3;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'heading',
          attrs: { level },
          content: [{ type: 'text', text: `New Heading ${level}` }],
        })
        .run();
    },
    [editor],
  );

  const deleteCurrentSection = useCallback(() => {
    removeHeadingAtSelection(editor);
  }, [editor]);

  return (
    <div className="finding-aid" aria-label="Finding aid editor">
      <div className="finding-aid__toolbar">
        <div className="finding-aid__toolbar-left">
          <span>Finding Aid</span>
          <span className="finding-aid__toolbar-hint">
            A descriptive guide that helps locate and understand archival materials
          </span>
        </div>

        <div className="finding-aid__toolbar-actions">
          <div className="finding-aid__section-controls">
            <select
              value={sectionDepth}
              onChange={(event) => setSectionDepth(Number(event.target.value))}
              aria-label="Section level"
            >
              <option value={0}>Heading 1</option>
              <option value={1}>Heading 2</option>
              <option value={2}>Heading 3</option>
            </select>
            <EditorActionButton
              ariaLabel="Add section"
              onClick={() => insertSectionAtDepth(sectionDepth)}
              disabled={!editor}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </EditorActionButton>
          </div>

          <EditorActionButton ariaLabel="Delete section" onClick={deleteCurrentSection} disabled={!editor}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </EditorActionButton>

          <EditorActionButton ariaLabel="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 7H5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M5 11c2.5-4 10-5 14 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </EditorActionButton>

          <EditorActionButton ariaLabel="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 7h4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M19 11c-2.5-4-10-5-14 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Bold"
            active={Boolean(editor?.isActive('bold'))}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5h6a3 3 0 0 1 0 6H7zM7 11h7a3 3 0 0 1 0 6H7z" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Italic"
            active={Boolean(editor?.isActive('italic'))}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 5h8M6 19h8M14 5l-4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Underline"
            active={Boolean(editor?.isActive('underline'))}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5v6a5 5 0 0 0 10 0V5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Strikethrough"
            active={Boolean(editor?.isActive('strike'))}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M8 5h8a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h8" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </EditorActionButton>

          <EditorActionButton ariaLabel="Link" onClick={setLink} disabled={!editor}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 13a5 5 0 0 1 0-7l2-2a5 5 0 0 1 7 7l-1 1" stroke="currentColor" strokeWidth="2" fill="none" />
              <path d="M14 11a5 5 0 0 1 0 7l-2 2a5 5 0 0 1-7-7l1-1" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Bulleted list"
            active={Boolean(editor?.isActive('bulletList'))}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6h10M9 12h10M9 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="5" cy="6" r="1.5" fill="currentColor" />
              <circle cx="5" cy="12" r="1.5" fill="currentColor" />
              <circle cx="5" cy="18" r="1.5" fill="currentColor" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Numbered list"
            active={Boolean(editor?.isActive('orderedList'))}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6h10M9 12h10M9 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 7h2M4 13h2M4 19h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Quote"
            active={Boolean(editor?.isActive('blockquote'))}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            disabled={!editor}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7h4v6H7zM13 7h4v6h-4z" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Heading 1"
            active={Boolean(editor?.isActive('heading', { level: 1 }))}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={!editor}
          >
            <span className="finding-aid__tool-text">H1</span>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Heading 2"
            active={Boolean(editor?.isActive('heading', { level: 2 }))}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={!editor}
          >
            <span className="finding-aid__tool-text">H2</span>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Heading 3"
            active={Boolean(editor?.isActive('heading', { level: 3 }))}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            disabled={!editor}
          >
            <span className="finding-aid__tool-text">H3</span>
          </EditorActionButton>

          <EditorActionButton
            ariaLabel="Paragraph"
            active={Boolean(editor?.isActive('paragraph'))}
            onClick={() => editor?.chain().focus().setParagraph().run()}
            disabled={!editor}
          >
            <span className="finding-aid__tool-text">P</span>
          </EditorActionButton>
        </div>
      </div>

      <div className="finding-aid__editor-shell">
        <div className="finding-aid__editor-page finding-aid__editor-page--paginated">
          {editor ? <EditorContent editor={editor} /> : <div className="finding-aid__loading">Loading editor...</div>}
        </div>
      </div>
    </div>
  );
}
