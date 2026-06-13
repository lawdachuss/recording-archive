import serverless from "serverless-http";
import app from "../artifacts/api-server/src/app";

export const handler = serverless(app);
