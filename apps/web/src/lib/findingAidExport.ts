import type { PMNode, SeriesDoc } from '../../../../src/contracts/types';
import {
  AlignmentType,
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  TableOfContents,
  TextRun,
} from 'docx';

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

type HtmlBuildOptions = {
  printable: boolean;
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
  const baseFilename = sanitizeFilename(
    `${model.title}-${model.scope === 'collection' ? 'collection' : 'series'}-finding-aid`,
  );

  if (format === 'ead') {
    const xml = buildEadXml(model);
    downloadTextFile(`${baseFilename}.ead.xml`, xml, 'application/xml;charset=utf-8');
    return;
  }

  const html = buildFindingAidHtml(model, { printable: format === 'pdf' });

  if (format === 'html') {
    downloadTextFile(`${baseFilename}.html`, html, 'text/html;charset=utf-8');
    return;
  }

  if (format === 'word') {
    const docxBlob = await buildDocxBlob(model);
    downloadBlobFile(`${baseFilename}.docx`, docxBlob);
    return;
  }

  openPrintPreview(html, `${model.title} · PDF Export`);
}

function buildFindingAidHtml(model: FindingAidExportModel, options: HtmlBuildOptions): string {
  const generatedAt = model.generatedAt.toLocaleString();
  const descriptionMarkup =
    model.description.length > 0
      ? `<p class="cover-description">${escapeHtml(model.description)}</p>`
      : '<p class="cover-description cover-description--muted">No collection description provided.</p>';

  const tocRows = model.sections
    .map((section) => {
      const number = section.pathSegments.length > 0 ? section.pathSegments.join('.') : '—';
      return `
        <li class="toc-row" style="--toc-depth:${section.depth}">
          <a href="#${escapeHtml(section.anchorId)}">
            <span class="toc-row__number">${escapeHtml(number)}</span>
            <span class="toc-row__title">${escapeHtml(section.title)}</span>
            <span class="toc-row__page">${section.pageNumber}</span>
          </a>
        </li>
      `;
    })
    .join('');

  const sectionMarkup = model.sections
    .map((section) => {
      const headingTag = section.depth <= 0 ? 'h2' : section.depth === 1 ? 'h3' : section.depth === 2 ? 'h4' : 'h5';
      const pathLabel = section.pathSegments.length > 0 ? section.pathSegments.join('.') : '';
      const metaBits = [
        section.level.toUpperCase(),
        pathLabel.length > 0 ? pathLabel : null,
        section.refCode ? `Ref: ${section.refCode}` : null,
        section.dates ? `Dates: ${section.dates}` : null,
        `p. ${section.pageNumber}`,
      ].filter((value): value is string => value != null && value.length > 0);

      const paragraphs = section.paragraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join('');

      const fields = section.fields.length
        ? `<dl class="field-grid">
            ${section.fields
              .map(
                (field) =>
                  `<div><dt>${escapeHtml(field.key)}</dt><dd>${escapeHtml(field.value)}</dd></div>`,
              )
              .join('')}
          </dl>`
        : '';

      return `
        <article id="${escapeHtml(section.anchorId)}" class="finding-section finding-section--${section.level}">
          <header>
            <p class="finding-section__meta">${escapeHtml(metaBits.join(' · '))}</p>
            <${headingTag}>${escapeHtml(section.title)}</${headingTag}>
          </header>
          ${paragraphs}
          ${fields}
        </article>
      `;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(model.title)} · Finding Aid Export</title>
    <style>
      :root {
        --ink: #0f172a;
        --muted: #475569;
        --line: #e2e8f0;
        --paper: #ffffff;
        --accent: #b91c1c;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: var(--ink);
        background: #f8fafc;
      }

      .export-page {
        width: min(960px, calc(100vw - 2rem));
        margin: 1rem auto;
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 0.75rem;
        padding: 2.2rem 2.4rem;
      }

      .export-page--cover {
        min-height: 80vh;
        display: grid;
        align-content: center;
        gap: 1rem;
      }

      .cover-kicker {
        margin: 0;
        color: var(--accent);
        font-size: 0.88rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 700;
      }

      .cover-title {
        margin: 0;
        font-size: clamp(1.8rem, 2.8vw, 2.6rem);
        line-height: 1.08;
      }

      .cover-subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
      }

      .cover-meta {
        margin: 0;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .cover-description {
        margin: 0.4rem 0 0;
        font-size: 1rem;
        line-height: 1.5;
      }

      .cover-description--muted {
        color: var(--muted);
      }

      .toc-title {
        margin: 0 0 1rem;
        font-size: 1.5rem;
      }

      .toc-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.18rem;
      }

      .toc-row {
        margin: 0;
      }

      .toc-row a {
        display: grid;
        grid-template-columns: 5.4rem 1fr auto;
        gap: 0.55rem;
        text-decoration: none;
        color: inherit;
        padding: 0.14rem 0 0.14rem calc(var(--toc-depth) * 1rem);
        border-bottom: 1px dotted #cbd5e1;
        align-items: baseline;
      }

      .toc-row__number {
        color: var(--muted);
        font-family: "Courier New", monospace;
        font-size: 0.79rem;
      }

      .toc-row__title {
        font-size: 0.94rem;
      }

      .toc-row__page {
        font-family: "Courier New", monospace;
        font-size: 0.8rem;
        color: var(--muted);
      }

      .finding-section {
        margin: 0 0 1.2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--line);
      }

      .finding-section:last-child {
        border-bottom: 0;
        margin-bottom: 0;
        padding-bottom: 0;
      }

      .finding-section__meta {
        margin: 0 0 0.35rem;
        color: var(--muted);
        font-family: "Courier New", monospace;
        font-size: 0.76rem;
      }

      .finding-section h2,
      .finding-section h3,
      .finding-section h4,
      .finding-section h5 {
        margin: 0 0 0.45rem;
      }

      .finding-section p {
        margin: 0 0 0.55rem;
        line-height: 1.52;
      }

      .field-grid {
        margin: 0.65rem 0 0;
        display: grid;
        gap: 0.4rem;
      }

      .field-grid div {
        display: grid;
        gap: 0.1rem;
      }

      .field-grid dt {
        font-family: "Courier New", monospace;
        font-size: 0.74rem;
        color: var(--muted);
        text-transform: uppercase;
      }

      .field-grid dd {
        margin: 0;
        font-size: 0.92rem;
      }

      @media print {
        @page {
          size: letter portrait;
          margin: 0.45in;
        }

        body {
          background: #fff;
        }

        .export-page {
          width: auto;
          margin: 0;
          border: 0;
          border-radius: 0;
          padding: 0.1in 0.1in 0.2in;
          page-break-after: always;
        }

        .export-page:last-child {
          page-break-after: auto;
        }

        a {
          color: inherit;
          text-decoration: none;
        }
      }
    </style>
  </head>
  <body data-printable="${options.printable ? '1' : '0'}">
    <section class="export-page export-page--cover">
      <p class="cover-kicker">${escapeHtml(model.subtitle)}</p>
      <h1 class="cover-title">${escapeHtml(model.title)}</h1>
      <p class="cover-subtitle">${escapeHtml(model.institutionName)}</p>
      <p class="cover-meta">Collection ID: ${escapeHtml(model.collectionId)} · Generated: ${escapeHtml(generatedAt)}</p>
      ${descriptionMarkup}
    </section>

    <section class="export-page export-page--toc">
      <h2 class="toc-title">Table Of Contents</h2>
      <ol class="toc-list">
        ${tocRows}
      </ol>
    </section>

    <main class="export-page export-page--content">
      ${sectionMarkup}
    </main>
  </body>
</html>`;
}

function buildEadXml(model: FindingAidExportModel): string {
  const lines: string[] = [];
  const generatedIso = model.generatedAt.toISOString();
  const generatedDate = model.generatedAt.toISOString().slice(0, 10);

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ead xmlns="http://ead3.archivists.org/schema/" audience="external">');
  lines.push('  <control>');
  lines.push(`    <recordid>${escapeXml(`${model.collectionId}-${model.scope}`)}</recordid>`);
  lines.push(`    <maintenancehistory><maintenanceevent><eventdatetime standarddatetime="${escapeXml(generatedIso)}">${escapeXml(generatedDate)}</eventdatetime></maintenanceevent></maintenancehistory>`);
  lines.push('  </control>');
  lines.push('  <archdesc level="collection">');
  lines.push('    <did>');
  lines.push(`      <unitid>${escapeXml(model.collectionId)}</unitid>`);
  lines.push(`      <unittitle>${escapeXml(model.title)}</unittitle>`);
  lines.push(`      <repository><corpname>${escapeXml(model.institutionName)}</corpname></repository>`);
  lines.push('    </did>');
  if (model.description.length > 0) {
    lines.push('    <scopecontent>');
    lines.push(`      <p>${escapeXml(model.description)}</p>`);
    lines.push('    </scopecontent>');
  }
  lines.push('    <dsc>');

  let openDepth = -1;
  for (const section of model.sections) {
    while (openDepth >= section.depth) {
      lines.push(`${'  '.repeat(openDepth + 3)}</c>`);
      openDepth -= 1;
    }

    const componentIndent = `${'  '.repeat(section.depth + 3)}`;
    const childIndent = `${'  '.repeat(section.depth + 4)}`;
    lines.push(
      `${componentIndent}<c level="${escapeXml(toEadLevel(section.level))}" id="${escapeXml(section.anchorId)}">`,
    );
    lines.push(`${childIndent}<did>`);
    lines.push(`${childIndent}  <unittitle>${escapeXml(section.title)}</unittitle>`);
    if (section.refCode) {
      lines.push(`${childIndent}  <unitid>${escapeXml(section.refCode)}</unitid>`);
    }
    if (section.dates) {
      lines.push(`${childIndent}  <unitdate>${escapeXml(section.dates)}</unitdate>`);
    }
    lines.push(`${childIndent}</did>`);

    if (section.paragraphs.length > 0) {
      lines.push(`${childIndent}<scopecontent>`);
      section.paragraphs.forEach((paragraph) => {
        lines.push(`${childIndent}  <p>${escapeXml(paragraph)}</p>`);
      });
      lines.push(`${childIndent}</scopecontent>`);
    }

    if (section.fields.length > 0) {
      lines.push(`${childIndent}<odd>`);
      lines.push(`${childIndent}  <head>Item Metadata</head>`);
      lines.push(`${childIndent}  <list>`);
      section.fields.forEach((field) => {
        lines.push(`${childIndent}    <item>${escapeXml(`${field.key}: ${field.value}`)}</item>`);
      });
      lines.push(`${childIndent}  </list>`);
      lines.push(`${childIndent}</odd>`);
    }

    openDepth = section.depth;
  }

  while (openDepth >= 0) {
    lines.push(`${'  '.repeat(openDepth + 3)}</c>`);
    openDepth -= 1;
  }

  lines.push('    </dsc>');
  lines.push('  </archdesc>');
  lines.push('</ead>');

  return `${lines.join('\n')}\n`;
}

function toEadLevel(level: FindingAidLevel): string {
  if (level === 'subseries') {
    return 'subseries';
  }
  return level;
}

function depthToHeading(depth: number) {
  if (depth <= 0) {
    return HeadingLevel.HEADING_1;
  }
  if (depth === 1) {
    return HeadingLevel.HEADING_2;
  }
  if (depth === 2) {
    return HeadingLevel.HEADING_3;
  }
  if (depth === 3) {
    return HeadingLevel.HEADING_4;
  }
  return HeadingLevel.HEADING_5;
}

async function buildDocxBlob(model: FindingAidExportModel): Promise<Blob> {
  const generatedAt = model.generatedAt.toLocaleString();
  const children: Array<Paragraph | TableOfContents> = [];

  children.push(
    new Paragraph({
      text: model.subtitle,
      heading: HeadingLevel.HEADING_3,
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
    }),
  );
  children.push(
    new Paragraph({
      text: model.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );
  children.push(
    new Paragraph({
      text: model.institutionName,
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Collection ID: ${model.collectionId} · Generated: ${generatedAt}`,
          italics: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
  );
  if (model.description.length > 0) {
    children.push(
      new Paragraph({
        text: model.description,
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
      }),
    );
  }

  children.push(new Paragraph({ text: '', pageBreakBefore: true }));
  children.push(
    new Paragraph({
      text: 'Table of Contents',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
  );
  children.push(
    new TableOfContents(' ', {
      hyperlink: true,
      headingStyleRange: '1-5',
    }),
  );

  children.push(new Paragraph({ text: '', pageBreakBefore: true }));

  for (const section of model.sections) {
    const pathLabel = section.pathSegments.length > 0 ? section.pathSegments.join('.') : '';
    const metaLine = [
      section.level.toUpperCase(),
      pathLabel.length > 0 ? pathLabel : null,
      section.refCode ? `Ref: ${section.refCode}` : null,
      section.dates ? `Dates: ${section.dates}` : null,
      `p. ${section.pageNumber}`,
    ]
      .filter((value): value is string => value != null && value.length > 0)
      .join(' · ');

    children.push(
      new Paragraph({
        text: section.title,
        heading: depthToHeading(section.depth),
        spacing: { before: 260, after: 120 },
      }),
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaLine, italics: true })],
        spacing: { after: 120 },
      }),
    );

    for (const paragraph of section.paragraphs) {
      children.push(
        new Paragraph({
          text: paragraph,
          spacing: { after: 100 },
        }),
      );
    }

    if (section.fields.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'Item Metadata', bold: true, underline: {} })],
          spacing: { before: 100, after: 80 },
        }),
      );
      for (const field of section.fields) {
        children.push(
          new Paragraph({
            text: `${field.key}: ${field.value}`,
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
      }
    }
  }

  const doc = new DocxDocument({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.PORTRAIT,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

function openPrintPreview(html: string, title: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF export is only available in a browser.');
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    frame.remove();
  };

  const printFromFrame = () => {
    const printWindow = frame.contentWindow;
    if (!printWindow) {
      cleanup();
      window.alert('Could not open print preview. Please allow printing and try again.');
      return;
    }

    printWindow.document.title = title;
    printWindow.addEventListener('afterprint', cleanup, { once: true });
    printWindow.focus();
    printWindow.print();

    // Fallback cleanup if afterprint doesn't fire.
    window.setTimeout(cleanup, 120000);
  };

  frame.addEventListener('load', () => {
    window.setTimeout(printFromFrame, 40);
  });

  document.body.append(frame);
  try {
    frame.srcdoc = html;
  } catch {
    cleanup();
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.alert('Could not open print preview. Please allow popups and printing, then retry.');
      return;
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.document.title = title;
    popup.addEventListener('load', () => {
      popup.focus();
      popup.print();
    }, { once: true });
  }
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  if (typeof document === 'undefined') {
    throw new Error('File download is only available in a browser.');
  }

  const blob = new Blob([content], { type: mimeType });
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

function sanitizeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'finding-aid-export';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
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
