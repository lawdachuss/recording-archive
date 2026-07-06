import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recordingsRouter from "./recordings";
import performersRouter from "./performers";
import tagsRouter from "./tags";
import statsRouter from "./stats";
import reactionsRouter from "./reactions";
import commentsRouter from "./comments";
import requestsRouter from "./requests";
import userRouter from "./user";
import cacheAdminRouter from "./cache-admin";
import adminRouter from "./admin";
import searchRouter from "./search";
import mediaProxyRouter from "./media-proxy";
import migrateAuthRouter from "./migrate-auth";
import viewsRouter from "./views";

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
