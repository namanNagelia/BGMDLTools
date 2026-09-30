import { Router } from "express";
import * as controller from "../controllers/gleague-public.controller.js";

const router: Router = Router();

router.get("/board", controller.getBoard);
router.get("/requests", controller.listMine);
router.post("/requests", controller.submit);
router.post("/requests/:id/withdraw", controller.withdraw);

export default router;
