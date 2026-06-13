import serverless from "serverless-http";
import app from "../../api-server/src/app";

export const handler = serverless(app);
