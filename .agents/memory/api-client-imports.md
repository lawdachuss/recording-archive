---
name: API client barrel imports
description: Deep imports into @workspace/api-client-react break Vite; always use the barrel
---

**The rule:** Never use deep import paths like `@workspace/api-client-react/src/generated/api.schemas`. Always import from the package barrel.

```ts
// WRONG - breaks Vite resolution
import { Recording } from "@workspace/api-client-react/src/generated/api.schemas";

// CORRECT - use the barrel
import { Recording } from "@workspace/api-client-react";
```

**Why:** The lib package's `package.json` only exposes the barrel export. Deep paths into `src/` are not resolvable by Vite's package resolver and throw "Missing specifier" errors at runtime.

**How to apply:** When design subagents or codegen consumers write imports, always verify they use the barrel path.
