import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recordingsRouter from "./recordings";
import performersRouter from "./performers";
import tagsRouter from "./tags";
import statsRouter from "./stats";
import reactionsRouter from "./reactions";
import commentsRouter from "./comments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recordingsRouter);
router.use(performersRouter);
router.use(tagsRouter);
router.use(statsRouter);
router.use(reactionsRouter);
router.use(commentsRouter);

export default router;
