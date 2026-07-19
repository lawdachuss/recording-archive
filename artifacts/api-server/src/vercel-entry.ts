// Vercel serverless function entry point.
// This file is bundled into api/index.mjs by esbuild (vercel-build.mjs).
// The source lives here (outside the Vercel api/ directory) to avoid
// path conflicts with the pre-bundled output that Vercel deploys.
import app from "./app.js";

export default app;
