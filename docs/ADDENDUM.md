# Addendum: Reference Artifacts

This repository now includes canonical addendum artifacts from the PRD.

## A) Reference JSON fixtures

- `src/fixtures/manifest.doc.json`
- `src/fixtures/series.deep-hierarchy.doc.json`
- `src/fixtures/item-fields.photograph.json`
- `src/fixtures/item-fields.object.json`
- `src/fixtures/suggestion.inline-insert.paragraph.json`
- `src/fixtures/suggestion.inline-delete.paragraph.json`
- `src/fixtures/suggestion.block.create-item.json`
- `src/fixtures/suggestion.block.reorder-sibling.json`
- `src/fixtures/suggestion.block.move-cross-series.source.json`
- `src/fixtures/suggestion.block.move-cross-series.target.json`
- `src/fixtures/export.output.doc.json`

## B) Contracts

- TypeScript types: `src/contracts/types.ts`
- JSON Schema (draft 2020-12): `src/contracts/archival-editor.schema.json`

## C) Golden-path flows

1. Inline suggestion group accept/reject:
   - `suggestion_insert` accept removes mark only.
   - `suggestion_insert` reject removes marked text.
   - `suggestion_delete` accept removes suggestion node.
   - `suggestion_delete` reject restores stored text.
2. CREATE_ITEM block suggestion:
   - Accept creates one canonical item with defaults merged with payload.
   - Reject removes suggestion block.
3. REORDER_SIBLING block suggestion:
   - Accept only if both nodes still share the same parent.
   - Otherwise mark stale and disable accept.
4. MOVE_SUBTREE_CROSS_SERIES paired suggestion:
   - Shared `sid` exists in source and target docs.
   - Accept inserts in target, deletes in source, then removes both proposal blocks.
5. Export:
   - Read manifest order.
   - Strip all suggestion artifacts.
   - Assemble monolithic collection doc.
