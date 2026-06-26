import { Router } from "express";
import * as seasonController from "../controllers/season.controller.js";
import * as offerController from "../controllers/offer.controller.js";

const router: Router = Router();

router.get("/seasons/current/fas", seasonController.listCurrentSeasonFAs);
router.post("/free-agents/:id/renounce", seasonController.renounceFA);

router.post("/free-agents/:id/offers", offerController.create);
router.post("/free-agents/:id/offers/preview", offerController.preview);

export default router;
