import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import modRoutes from "./routes/mod.route.js";
import seasonRoutes from "./routes/season.route.js";
import publicRoutes from "./routes/public.route.js";

const app = express();

app.use(
  cors({
    origin: config.ALLOWED_ORIGIN,
    credentials: true,
    exposedHeaders: ["X-Signed-Count"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/mod", modRoutes);
app.use("/api/mod/seasons", seasonRoutes);
app.use("/api", publicRoutes);

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`[backend] listening on :${config.PORT}`);
});
