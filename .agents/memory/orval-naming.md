---
name: Orval naming collisions
description: How path params + query params on the same operationId generate TS2308 collisions in api-zod
---

When two routes share the same operationId prefix (e.g. `getRelatedRecordings` with both a path `{id}` param AND query params), Orval generates a `*Params` type in both `generated/api.ts` AND `generated/types/`, causing:

```
error TS2308: Module "./generated/api" has already exported a member named 'GetRelatedRecordingsParams'
```

**The rule:** If a route has a path `{id}` param AND also query params under the same operationId, move the id to a query param instead (e.g. `GET /recordings/related?id=...`).

**Why:** The collision is in the lib/api-zod barrel re-export. Orval emits the same name from two files.

**How to apply:** Check any route that has both path params and query params — prefer query-only params when the operationId would generate a `*Params` type that conflicts.
