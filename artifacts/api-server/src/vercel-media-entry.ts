import app from "./media-app.js";

// Vercel's Node.js runtime natively supports Express apps exported as default.
// This is a SEPARATE serverless function from api/index.mjs so image/video
// proxying gets its own concurrency pool and memory allocation — a thumbnail
// burst can't starve JSON API traffic (see docs/scaling-plan.md Stage 0.3).
export default app;
