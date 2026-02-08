import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import schema from '../schema/archival-editor.schema.json';
import type { CollectionManifestDoc, PMDoc, SeriesDoc } from './types';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema as object);

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateArchivalDoc(doc: unknown): ValidationResult {
  const valid = validate(doc) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map((error) => {
    const path = error.instancePath || '/';
    const keyword = error.keyword;
    const message = error.message ?? 'invalid';
    return `${path} ${keyword}: ${message}`;
  });

  return { valid: false, errors };
}

export function assertValidArchivalDoc(doc: unknown): asserts doc is PMDoc {
  const result = validateArchivalDoc(doc);
  if (!result.valid) {
    throw new Error(`Invalid archival doc: ${result.errors.join('; ')}`);
  }
}

export function isCollectionManifestDoc(doc: unknown): doc is CollectionManifestDoc {
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  const asDoc = doc as { type?: string; content?: unknown[] };
  if (asDoc.type !== 'doc' || !Array.isArray(asDoc.content) || asDoc.content.length !== 1) {
    return false;
  }

  return (asDoc.content[0] as { type?: string })?.type === 'collectionManifest';
}

export function isSeriesDoc(doc: unknown): doc is SeriesDoc {
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  const asDoc = doc as { type?: string; content?: unknown[] };
  if (asDoc.type !== 'doc' || !Array.isArray(asDoc.content) || asDoc.content.length !== 1) {
    return false;
  }

  return (asDoc.content[0] as { type?: string })?.type === 'series';
}
