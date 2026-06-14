import serverless from "serverless-http";
import app from "../../api-server/src/app";

// Vercel requires a default export for ESM serverless functions
export default serverless(app);
