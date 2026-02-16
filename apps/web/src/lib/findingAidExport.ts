import type { PMNode, SeriesDoc } from '../../../../src/contracts/types';
import { apiFetch } from './api';

export type ExportFormat = 'word' | 'ead' | 'html' | 'pdf';

export type SeriesExportInput = {
  collectionId: string;
  collectionTitle: string;
  institutionName: string;
  collectionDescription?: string;
  seriesId: string;
  seriesTitle: string;
  seriesDoc: SeriesDoc;
};

export type CollectionExportInput = {
  collectionId: string;
  collectionTitle: string;
  institutionName: string;
  collectionDescription?: string;
  series: Array<{
    seriesId: string;
    seriesTitle: string;
    docName: string;
    seriesDoc: SeriesDoc;
  }>;
};

type FindingAidLevel = 'series' | 'subseries' | 'file' | 'item';

type FindingAidField = {
  key: string;
  value: string;
};

type FindingAidSection = {
  anchorId: string;
  level: FindingAidLevel;
  title: string;
  pathSegments: number[];
  depth: number;
  dates: string | null;
  refCode: string | null;
  paragraphs: string[];
  fields: FindingAidField[];
  pageNumber: number;
};

type FindingAidExportModel = {
  scope: 'series' | 'collection';
  title: string;
  subtitle: string;
  collectionId: string;
  institutionName: string;
  description: string;
  generatedAt: Date;
  sections: FindingAidSection[];
};

const ESTIMATED_PAGE_CAPACITY = 3000;

export async function exportSeriesFindingAid(args: { format: ExportFormat; input: SeriesExportInput }) {
  const model = buildSeriesModel(args.input);
  await runExport(model, args.format);
}

export async function exportCollectionFindingAid(args: { format: ExportFormat; input: CollectionExportInput }) {
  const model = buildCollectionModel(args.input);
  await runExport(model, args.format);
}

function buildSeriesModel(input: SeriesExportInput): FindingAidExportModel {
  const sections = prefixSections(buildSeriesSections(input.seriesDoc, input.seriesTitle), [1], slugify(input.seriesId));
  const pagedSections = assignEstimatedPageNumbers(sections, 3);

  return {
    scope: 'series',
    title: input.seriesTitle,
    subtitle: `Series Finding Aid · ${input.collectionTitle}`,
    collectionId: input.collectionId,
    institutionName: input.institutionName,
    description: toNonEmptyString(input.collectionDescription) ?? '',
    generatedAt: new Date(),
    sections: pagedSections,
  };
}

function buildCollectionModel(input: CollectionExportInput): FindingAidExportModel {
  const stitched: FindingAidSection[] = [];

  input.series.forEach((entry, index) => {
    const base = buildSeriesSections(entry.seriesDoc, entry.seriesTitle);
    const prefixed = prefixSections(base, [index + 1], slugify(entry.seriesId || entry.docName));
    stitched.push(...prefixed);
  });

  const pagedSections = assignEstimatedPageNumbers(stitched, 3);

  return {
    scope: 'collection',
    title: input.collectionTitle,
    subtitle: 'Collection Finding Aid',
    collectionId: input.collectionId,
    institutionName: input.institutionName,
    description: toNonEmptyString(input.collectionDescription) ?? '',
    generatedAt: new Date(),
    sections: pagedSections,
  };
}

function prefixSections(sections: FindingAidSection[], prefix: number[], idPrefix: string): FindingAidSection[] {
  return sections.map((section) => ({
    ...section,
    anchorId: `${idPrefix}-${section.anchorId}`,
    pathSegments: [...prefix, ...section.pathSegments],
    depth: prefix.length - 1 + section.depth,
  }));
}

function buildSeriesSections(seriesDoc: SeriesDoc, titleOverride: string): FindingAidSection[] {
  const root = seriesDoc.content.find((node) => node.type === 'series') as PMNode | undefined;
  if (!root) {
    return [];
  }

  const rootId = toNonEmptyString(String(root.attrs?.id ?? '')) ?? `series-${crypto.randomUUID()}`;
  const rootTitle = toNonEmptyString(titleOverride) ?? toNonEmptyString(String(root.attrs?.title ?? '')) ?? 'Untitled Series';
  const rootDates = toNonEmptyString(String(root.attrs?.dates ?? ''));
  const rootRefCode = toNonEmptyString(String(root.attrs?.refCode ?? ''));
  const rootParagraphs = extractSeriesBodyParagraphs(root);

  const sections: FindingAidSection[] = [
    {
      anchorId: slugify(rootId),
      level: 'series',
      title: rootTitle,
      pathSegments: [],
      depth: 0,
      dates: rootDates,
      refCode: rootRefCode,
      paragraphs: rootParagraphs,
      fields: [],
      pageNumber: 0,
    },
  ];

  const hierarchyChildren = (root.content ?? []).filter((node) => node.type !== 'seriesOps' && node.type !== 'seriesBody');
  hierarchyChildren.forEach((child, index) => {
    walkHierarchyNode(child as PMNode, [index + 1], 1, sections);
  });

  return sections;
}

function walkHierarchyNode(node: PMNode, path: number[], depth: number, sections: FindingAidSection[]) {
  if (node.type === 'subseries' || node.type === 'file') {
    const id = toNonEmptyString(String(node.attrs?.id ?? '')) ?? `${node.type}-${crypto.randomUUID()}`;
    const title =
      toNonEmptyString(String(node.attrs?.title ?? '')) ??
      `${toTitleCase(node.type)} ${path.length > 0 ? path.join('.') : id}`;

    sections.push({
      anchorId: slugify(id),
      level: node.type,
      title,
      pathSegments: [...path],
      depth,
      dates: toNonEmptyString(String(node.attrs?.dates ?? '')),
      refCode: toNonEmptyString(String(node.attrs?.refCode ?? '')),
      paragraphs: [],
      fields: [],
      pageNumber: 0,
    });

    (node.content ?? []).forEach((child, index) => {
      walkHierarchyNode(child as PMNode, [...path, index + 1], depth + 1, sections);
    });
    return;
  }

  if (node.type === 'item') {
    const id = toNonEmptyString(String(node.attrs?.id ?? '')) ?? `item-${crypto.randomUUID()}`;
    const title =
      toNonEmptyString(String(node.attrs?.title ?? '')) ??
      `${toTitleCase(String(node.attrs?.itemType ?? 'item'))} ${path.length > 0 ? path.join('.') : id}`;

    sections.push({
      anchorId: slugify(id),
      level: 'item',
      title,
      pathSegments: [...path],
      depth,
      dates: null,
      refCode: null,
      paragraphs: extractItemBodyParagraphs(node),
      fields: extractItemFields(node),
      pageNumber: 0,
    });
  }
}

function extractSeriesBodyParagraphs(seriesNode: PMNode): string[] {
  const body = (seriesNode.content ?? []).find((node) => node.type === 'seriesBody') as PMNode | undefined;
  if (!body || !Array.isArray(body.content)) {
    return [];
  }
  return extractTextBlocks(body.content as PMNode[]);
}

function extractItemBodyParagraphs(itemNode: PMNode): string[] {
  const body = (itemNode.content ?? []).find((node) => node.type === 'itemBody') as PMNode | undefined;
  if (!body || !Array.isArray(body.content)) {
    return [];
  }
  return extractTextBlocks(body.content as PMNode[]);
}

function extractItemFields(itemNode: PMNode): FindingAidField[] {
  const fieldsNode = (itemNode.content ?? []).find((node) => node.type === 'itemFields') as PMNode | undefined;
  if (!fieldsNode || !Array.isArray(fieldsNode.content)) {
    return [];
  }

  const rows: FindingAidField[] = [];
  for (const child of fieldsNode.content as PMNode[]) {
    if (child.type === 'field') {
      const key = toTitleCase(String(child.attrs?.key ?? 'Field'));
      const value = stringifyFieldValue(child.attrs?.value);
      rows.push({ key, value });
      continue;
    }
    if (child.type === 'fieldGroup') {
      const groupKey = toTitleCase(String(child.attrs?.groupKey ?? 'Group'));
      for (const field of child.content ?? []) {
        if (field.type !== 'field') {
          continue;
        }
        const rawKey = toTitleCase(String(field.attrs?.key ?? 'Field'));
        const value = stringifyFieldValue(field.attrs?.value);
        rows.push({ key: `${groupKey} · ${rawKey}`, value });
      }
    }
  }

  return rows;
}

function extractTextBlocks(nodes: PMNode[]): string[] {
  const lines: string[] = [];

  const walk = (node: PMNode, orderedIndex: number | null = null) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = normalizeWhitespace(readNodeText(node));
      if (text.length > 0) {
        lines.push(text);
      }
      return;
    }

    if (node.type === 'bulletList') {
      for (const child of node.content ?? []) {
        if (child.type !== 'listItem') {
          continue;
        }
        const text = normalizeWhitespace(readNodeText(child));
        if (text.length > 0) {
          lines.push(`• ${text}`);
        }
      }
      return;
    }

    if (node.type === 'orderedList') {
      let index = 1;
      for (const child of node.content ?? []) {
        if (child.type !== 'listItem') {
          continue;
        }
        const text = normalizeWhitespace(readNodeText(child));
        if (text.length > 0) {
          lines.push(`${index}. ${text}`);
          index += 1;
        }
      }
      return;
    }

    if (node.type === 'listItem') {
      const text = normalizeWhitespace(readNodeText(node));
      if (text.length > 0) {
        const prefix = orderedIndex != null ? `${orderedIndex}. ` : '• ';
        lines.push(`${prefix}${text}`);
      }
      return;
    }

    if (node.type === 'image') {
      const alt = toNonEmptyString(String(node.attrs?.alt ?? '')) ?? toNonEmptyString(String(node.attrs?.title ?? ''));
      const src = toNonEmptyString(String(node.attrs?.src ?? ''));
      const label = alt ?? src ?? 'Image';
      lines.push(`[${label}]`);
      return;
    }

    const text = normalizeWhitespace(readNodeText(node));
    if (text.length > 0 && !node.content?.length) {
      lines.push(text);
      return;
    }

    for (const child of node.content ?? []) {
      walk(child as PMNode);
    }
  };

  nodes.forEach((node) => walk(node));
  return lines;
}

function readNodeText(node: PMNode): string {
  if (node.type === 'text') {
    return String(node.text ?? '');
  }
  if (node.type === 'suggestion_delete') {
    return String(node.attrs?.text ?? '');
  }
  if (!Array.isArray(node.content) || node.content.length === 0) {
    return '';
  }
  return node.content.map((child) => readNodeText(child as PMNode)).join(' ');
}

function assignEstimatedPageNumbers(sections: FindingAidSection[], startPage: number): FindingAidSection[] {
  let page = startPage;
  let pageLoad = 0;

  return sections.map((section, index) => {
    const sectionLoad = estimateSectionLoad(section);
    if (index > 0 && pageLoad + sectionLoad > ESTIMATED_PAGE_CAPACITY) {
      page += 1;
      pageLoad = 0;
    }
    pageLoad += sectionLoad;
    return {
      ...section,
      pageNumber: page,
    };
  });
}

function estimateSectionLoad(section: FindingAidSection): number {
  const paragraphLoad = section.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const fieldLoad = section.fields.reduce((sum, field) => sum + field.key.length + field.value.length + 40, 0);
  return 220 + section.title.length * 2 + paragraphLoad + fieldLoad + section.depth * 24;
}

async function runExport(model: FindingAidExportModel, format: ExportFormat) {
  const response = await apiFetch('/api/una/v1/exports/finding-aid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      format,
      model,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Export failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }

  const extension = format === 'word' ? 'docx' : format === 'ead' ? 'ead.xml' : format;
  const fallbackFilename = `${sanitizeFilename(`${model.title}-${model.scope}-finding-aid`)}.${extension}`;
  const filename = readFilenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackFilename;
  const blob = await response.blob();
  downloadBlobFile(filename, blob);
}

function downloadBlobFile(filename: string, blob: Blob) {
  if (typeof document === 'undefined') {
    throw new Error('File download is only available in a browser.');
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) {
    return null;
  }

  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // ignore and fall through to plain filename
    }
  }

  const quotedMatch = disposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = disposition.match(/filename\s*=\s*([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return null;
}

function sanitizeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'finding-aid-export';
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string): string {
  return sanitizeFilename(value);
}
