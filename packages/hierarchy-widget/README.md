# @archival/hierarchy-widget

Shared presentational hierarchy widget used by UNA desktop/mobile adapters.

## Usage

```tsx
import { HierarchyTreeWidget } from '@archival/hierarchy-widget';
import '@archival/hierarchy-widget/styles.css';
```

The host app is responsible for:
- Building `rows` from its in-memory hierarchy model.
- Supplying movement constraints via `canDrop` / `canDropToEnd`.
- Handling edits via callbacks (`onMove`, `onIndent`, `onAddChild`, etc).

This keeps one UI implementation while allowing each app to keep its own document model.
