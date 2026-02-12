import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Extension, JSONContent, Mark, Node, mergeAttributes } from '@tiptap/core';
import Heading from '@tiptap/extension-heading';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import type { PMNode } from '../../../../src/contracts/types';

type HierarchyLevel = 'series' | 'subseries' | 'box' | 'file' | 'item';

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
  onCursorHierarchyFocus?: (hierarchyId: string) => void;
  onCaretChange?: (caret: FindingAidCaret | null) => void;
  presenceUsers?: PresenceUser[];
  remoteCursors?: FindingAidRemoteCursor[];
  onChange: (nextContent: PMNode[]) => void;
};

type PresenceUser = {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  presenceKey?: string;
};

type FindingAidCaret = {
  anchor: number;
  head: number;
};

type FindingAidRemoteCursor = PresenceUser & FindingAidCaret;

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
    const labelPrefix = heading.pathLabel.length > 0 ? `${heading.pathLabel} ` : '';

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
          text: `${labelPrefix}${heading.title}`,
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

  return json.content as unknown as PMNode[];
}

function isHierarchyHeadingNode(node: PMNode): boolean {
  return node.type === 'heading' && node.attrs?.hierarchyId != null;
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

const REMOTE_CURSOR_PLUGIN_KEY = new PluginKey('findingAidRemoteCursors');
const REMOTE_CURSOR_REFRESH_META = 'findingAidRemoteCursorRefresh';

function clampDocPos(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const rounded = Math.round(value);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function buildRemoteCursorDecorations(doc: any, cursors: FindingAidRemoteCursor[]): DecorationSet {
  const maxPos = Math.max(1, doc.content.size);
  const decorations: Decoration[] = [];

  for (const cursor of cursors) {
    const anchor = clampDocPos(cursor.anchor, maxPos);
    const head = clampDocPos(cursor.head, maxPos);
    const start = Math.min(anchor, head);
    const end = Math.max(anchor, head);
    const color = cursor.color || '#0ea5e9';
    const markerKey = cursor.presenceKey ?? `${cursor.id}:${anchor}:${head}`;
    const displayName = cursor.name?.trim() || cursor.id;
    const initial = displayName.charAt(0).toUpperCase() || '?';

    if (end > start) {
      decorations.push(
        Decoration.inline(
          start,
          end,
          {
            class: 'finding-aid__remote-selection',
            style: `--remote-caret-color:${color};`,
          },
          { key: `selection-${markerKey}` },
        ),
      );
    }

    decorations.push(
      Decoration.widget(
        head,
        () => {
          const root = document.createElement('span');
          root.className = 'finding-aid__remote-caret';
          root.style.setProperty('--remote-caret-color', color);
          root.title = displayName;

          const bar = document.createElement('span');
          bar.className = 'finding-aid__remote-caret-bar';
          root.appendChild(bar);

          const label = document.createElement('span');
          label.className = 'finding-aid__remote-caret-label';
          label.textContent = initial;
          root.appendChild(label);

          return root;
        },
        { side: 1, key: `caret-${markerKey}` },
      ),
    );
  }

  return DecorationSet.create(doc, decorations);
}

const RemoteCursorExtension = Extension.create<{ getCursors: () => FindingAidRemoteCursor[] }>({
  name: 'remoteCursorDecorations',

  addOptions() {
    return {
      getCursors: () => [],
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: REMOTE_CURSOR_PLUGIN_KEY,
        state: {
          init: (_, state) => buildRemoteCursorDecorations(state.doc, this.options.getCursors()),
          apply: (tr, value) => {
            if (tr.docChanged || tr.getMeta(REMOTE_CURSOR_REFRESH_META)) {
              return buildRemoteCursorDecorations(tr.doc, this.options.getCursors());
            }
            return value.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

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
  onCursorHierarchyFocus,
  onCaretChange,
  presenceUsers = [],
  remoteCursors = [],
  onChange,
}: FindingAidEditorProps) {
  const isApplyingRef = useRef(false);
  const hierarchyHeadingsRef = useRef(hierarchyHeadings);
  const onCursorHierarchyFocusRef = useRef(onCursorHierarchyFocus);
  const onCaretChangeRef = useRef(onCaretChange);
  const remoteCursorsRef = useRef(remoteCursors);
  const lastReportedHierarchyIdRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const contentSignature = useMemo(() => JSON.stringify(content), [content]);
  const hierarchySignature = useMemo(() => JSON.stringify(hierarchyHeadings), [hierarchyHeadings]);
  const syncedContentSignatureRef = useRef(contentSignature);
  const syncedHierarchySignatureRef = useRef(hierarchySignature);
  const [sectionDepth, setSectionDepth] = useState(0);

  useEffect(() => {
    hierarchyHeadingsRef.current = hierarchyHeadings;
    onCursorHierarchyFocusRef.current = onCursorHierarchyFocus;
    onCaretChangeRef.current = onCaretChange;
    onChangeRef.current = onChange;
  }, [hierarchyHeadings, onCaretChange, onCursorHierarchyFocus, onChange]);

  useEffect(() => {
    remoteCursorsRef.current = remoteCursors;
  }, [remoteCursors]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      FindingAidHeading.configure({ levels: [1, 2, 3] }),
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      SuggestionInsertMark,
      SuggestionDeleteNode,
      RemoteCursorExtension.configure({
        getCursors: () => remoteCursorsRef.current,
      }),
    ],
    content: contentToDoc(content, hierarchyHeadings),
    editorProps: {
      attributes: {
        class: 'finding-aid__prose',
      },
    },
    onUpdate: ({ editor: current }) => {
      if (isApplyingRef.current) {
        return;
      }

      const fullContent = readContentFromEditor(current.getJSON());
      const normalized = normalizeHierarchySectionContent(fullContent, hierarchyHeadingsRef.current);
      const nextSignature = JSON.stringify(normalized);
      if (nextSignature === syncedContentSignatureRef.current) {
        return;
      }

      syncedContentSignatureRef.current = nextSignature;
      onChangeRef.current(normalized);
    },
    onSelectionUpdate: ({ editor: current }) => {
      if (!current.isFocused) {
        return;
      }

      const selection = current.state.selection;
      onCaretChangeRef.current?.({
        anchor: selection.anchor,
        head: selection.head,
      });

      const hierarchyId = readHierarchyIdAtSelection(current);
      if (!hierarchyId || lastReportedHierarchyIdRef.current === hierarchyId) {
        return;
      }

      lastReportedHierarchyIdRef.current = hierarchyId;
      onCursorHierarchyFocusRef.current?.(hierarchyId);
    },
    onBlur: () => {
      onCaretChangeRef.current?.(null);
    },
  }, []);

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (
      contentSignature === syncedContentSignatureRef.current &&
      hierarchySignature === syncedHierarchySignatureRef.current
    ) {
      return;
    }

    isApplyingRef.current = true;
    editor.commands.setContent(contentToDoc(content, hierarchyHeadings), false);
    isApplyingRef.current = false;

    syncedContentSignatureRef.current = contentSignature;
    syncedHierarchySignatureRef.current = hierarchySignature;
  }, [content, contentSignature, editor, hierarchyHeadings, hierarchySignature]);

  useEffect(() => {
    if (!editor || !focusedHierarchyId) {
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

    if (headingPos == null) {
      return;
    }

    lastReportedHierarchyIdRef.current = focusedHierarchyId;
    editor.chain().focus(headingPos + 1).scrollIntoView().run();
  }, [editor, focusedHierarchyId, focusRequestKey]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    editor.view.dispatch(editor.state.tr.setMeta(REMOTE_CURSOR_REFRESH_META, Date.now()));
  }, [editor, remoteCursors]);

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
          {presenceUsers.length > 0 ? (
            <div className="finding-aid__presence">
              <span>Here now:</span>
              <div className="finding-aid__presence-chips">
                {presenceUsers.slice(0, 4).map((entry) => (
                  <span
                    key={entry.presenceKey ?? entry.id}
                    className="finding-aid__presence-chip"
                    style={{ background: entry.color }}
                    title={entry.name}
                  >
                    {entry.avatar ? <img src={entry.avatar} alt={entry.name} /> : (entry.name.trim().charAt(0) || '?').toUpperCase()}
                  </span>
                ))}
                {presenceUsers.length > 4 ? (
                  <span className="finding-aid__presence-overflow">+{presenceUsers.length - 4}</span>
                ) : null}
              </div>
            </div>
          ) : null}
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
        <div className="finding-aid__editor-page">
          {editor ? <EditorContent editor={editor} /> : <div className="finding-aid__loading">Loading editor...</div>}
        </div>
      </div>
    </div>
  );
}
