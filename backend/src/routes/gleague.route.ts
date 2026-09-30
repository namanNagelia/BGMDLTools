import { Router } from "express";
import * as controller from "../controllers/gleague.controller.js";
import { modAuth } from "../middleware/modAuth.js";

const router: Router = Router();

router.use(modAuth);

router.post("/:id/link", controller.linkGlExport);
router.get("/:id/board", controller.getBoard);
router.post("/:id/validate", controller.validateBatch);
router.post("/:id/commit", controller.commitBatch);
router.get("/:id/export/:side", controller.downloadExport);
router.get("/:id/requests", controller.listPending);
router.post("/:id/requests/approve", controller.approvePending);
router.post("/:id/requests/decline", controller.declinePending);
router.post("/:id/refresh", controller.refreshBoard);

export default router;
