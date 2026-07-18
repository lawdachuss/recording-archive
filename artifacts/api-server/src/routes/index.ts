import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import recordingsRouter from "./recordings.js";
import performersRouter from "./performers.js";
import tagsRouter from "./tags.js";
import statsRouter from "./stats.js";
import reactionsRouter from "./reactions.js";
import commentsRouter from "./comments.js";
import requestsRouter from "./requests.js";
import userRouter from "./user.js";
import cacheAdminRouter from "./cache-admin.js";
import adminRouter from "./admin.js";
import searchRouter from "./search.js";
import mediaProxyRouter from "./media-proxy.js";
import migrateAuthRouter from "./migrate-auth.js";
import viewsRouter from "./views.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recordingsRouter);
router.use(performersRouter);
router.use(tagsRouter);
router.use(statsRouter);
router.use(reactionsRouter);
router.use(commentsRouter);
router.use(requestsRouter);
router.use(userRouter);
router.use(cacheAdminRouter);
router.use(adminRouter);
router.use(searchRouter);
router.use(mediaProxyRouter);
router.use(migrateAuthRouter);
router.use(viewsRouter);

export default router;
