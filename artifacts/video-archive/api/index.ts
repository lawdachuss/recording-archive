// Vercel natively supports Express apps as default exports.
// No serverless-http wrapper needed — Vercel passes HTTP requests directly.
import app from "../../api-server/src/app";

export default app;
