import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recordingsRouter from "./recordings";
import performersRouter from "./performers";
import tagsRouter from "./tags";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recordingsRouter);
router.use(performersRouter);
router.use(tagsRouter);
router.use(statsRouter);

export default router;
