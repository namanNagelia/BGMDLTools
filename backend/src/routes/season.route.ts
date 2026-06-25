import { Router } from "express";
import * as controller from "../controllers/season.controller.js";
import { modAuth } from "../middleware/modAuth.js";

const router: Router = Router();

router.use(modAuth);

router.get("/", controller.list);
router.post("/", controller.create);
router.post("/from-link", controller.createFromLink);
router.patch("/:id", controller.update);
router.post("/:id/current", controller.setCurrent);
router.post("/:id/parse-sheets", controller.parseSheets);
router.post("/:id/ingest-fas", controller.ingestFAs);
router.delete("/:id", controller.remove);

export default router;
