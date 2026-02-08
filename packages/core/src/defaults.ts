import { v4 as uuidv4 } from 'uuid';

import type { FieldGroupNode, FieldNode, ItemNode, ItemType } from './types';

const TEXT = 'text' as const;
const DATE = 'date' as const;
const NUMBER = 'number' as const;
const SELECT = 'select' as const;
const BOOLEAN = 'boolean' as const;

function field(key: string, valueType: FieldNode['attrs']['valueType'], value: FieldNode['attrs']['value']): FieldNode {
  return {
    type: 'field',
    attrs: {
      id: uuidv4(),
      key,
      valueType,
      value,
    },
  };
}

function measurementGroup(
  groupKey: 'height' | 'weight',
  value: number | null,
  unit: string,
): FieldGroupNode {
  return {
    type: 'fieldGroup',
    attrs: {
      id: uuidv4(),
      groupKey,
    },
    content: [field('value', NUMBER, value), field('unit', SELECT, unit)],
  };
}

function asArray(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (input == null) {
    return [];
  }
  return [input];
}

function toNumberOrNull(input: unknown): number | null {
  if (input == null || input === '') {
    return null;
  }
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

export function createDefaultItemFields(itemType: ItemType, initialFields: Record<string, any> = {}) {
  const content: Array<FieldNode | FieldGroupNode> = [];

  if (itemType === 'photograph') {
    for (const subject of asArray(initialFields.subjects)) {
      content.push(field('subjects', TEXT, String(subject)));
    }
    for (const object of asArray(initialFields.objects)) {
      content.push(field('objects', TEXT, String(object)));
    }
    content.push(field('date', DATE, initialFields.date ?? ''));
    content.push(field('takenBy', TEXT, initialFields.takenBy ?? ''));
    content.push(field('materialType', SELECT, initialFields.materialType ?? 'other'));
    content.push(field('pii', BOOLEAN, initialFields.pii ?? false));
  }

  if (itemType === 'document') {
    content.push(field('transcription', TEXT, initialFields.transcription ?? ''));
    content.push(field('date', DATE, initialFields.date ?? ''));
    for (const subject of asArray(initialFields.subjectsMentioned)) {
      content.push(field('subjectsMentioned', TEXT, String(subject)));
    }
    content.push(field('extent', TEXT, initialFields.extent ?? ''));
  }

  if (itemType === 'object') {
    const heights = asArray(initialFields.height);
    const weights = asArray(initialFields.weight);

    if (heights.length === 0) {
      content.push(measurementGroup('height', null, 'cm'));
    } else {
      for (const h of heights) {
        const entry = (h ?? {}) as Record<string, unknown>;
        content.push(measurementGroup('height', toNumberOrNull(entry.value), String(entry.unit ?? 'cm')));
      }
    }

    if (weights.length === 0) {
      content.push(measurementGroup('weight', null, 'kg'));
    } else {
      for (const w of weights) {
        const entry = (w ?? {}) as Record<string, unknown>;
        content.push(measurementGroup('weight', toNumberOrNull(entry.value), String(entry.unit ?? 'kg')));
      }
    }

    content.push(field('material', TEXT, initialFields.material ?? ''));
  }

  return {
    type: 'itemFields' as const,
    content,
  };
}

export function createItemNode(args: {
  itemType: ItemType;
  initialFields?: Record<string, any>;
  initialBodyText?: string;
}): ItemNode {
  return {
    type: 'item',
    attrs: {
      id: uuidv4(),
      itemType: args.itemType,
    },
    content: [
      createDefaultItemFields(args.itemType, args.initialFields ?? {}),
      {
        type: 'itemBody',
        content: args.initialBodyText
          ? [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: args.initialBodyText }],
              },
            ]
          : [],
      },
    ],
  };
}
