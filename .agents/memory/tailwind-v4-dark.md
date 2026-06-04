---
name: Tailwind v4 dark mode
description: How to force dark mode globally in Tailwind v4 without @apply dark
---

In Tailwind v4, `dark` is not an apply-able utility class. Using `@apply dark` in CSS throws "Cannot apply unknown utility class `dark`".

**The rule:** Add `dark` class to `document.documentElement` from JavaScript instead.

```ts
// src/main.tsx
document.documentElement.classList.add("dark");
```

**Why:** Tailwind v4 treats `dark` as a variant selector (via `@custom-variant dark (&:is(.dark *))`), not a utility class. It cannot be used with `@apply`.

**How to apply:** Any time you want to force dark mode globally, do it in `main.tsx` before rendering the React root.
