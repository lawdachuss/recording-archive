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
import searchRouter from "./search";

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
router.use(searchRouter);

export default router;
