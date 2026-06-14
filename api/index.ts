// Vercel natively supports Express apps as default exports.
// The @vercel/node builder compiles this and bundles all dependencies.
import app from "../artifacts/api-server/src/app";

export default app;
