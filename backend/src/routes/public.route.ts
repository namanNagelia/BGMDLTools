import { Router } from "express";
import * as seasonController from "../controllers/season.controller.js";

const router: Router = Router();

router.get("/seasons/current/fas", seasonController.listCurrentSeasonFAs);

export default router;
