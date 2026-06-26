import { Router } from "express";
import * as controller from "../controllers/mod.controller.js";
import * as offerController from "../controllers/offer.controller.js";
import { modAuth } from "../middleware/modAuth.js";

const router: Router = Router();

// public
router.post("/login", controller.login);
router.post("/logout", controller.logout);

// mod-only
router.get("/me", modAuth, controller.me);
router.post("/league/fetch", modAuth, controller.fetchLeague);
router.get("/offers", modAuth, offerController.listAllForMod);
router.post("/offers/:id/withdraw", modAuth, offerController.modWithdraw);

export default router;
