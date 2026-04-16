import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./config.js";
import { ensureInstallationComplete } from "./database.js";
import { installRouter } from "./install-routes.js";
import { apiRouter, registerErrorHandler } from "./routes.js";

const app = express();

app.use(
  cors({
    origin: env.APP_ORIGIN,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/api/install", installRouter);
app.use("/api", ensureInstallationComplete, apiRouter);

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const webDistDir = path.resolve(currentDir, "../web");

if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api")) {
      return next();
    }
    response.sendFile(path.join(webDistDir, "index.html"));
  });
}

registerErrorHandler(app);

app.listen(env.PORT, env.HOST, () => {
  console.log(`Dashboard server listening on http://${env.HOST}:${env.PORT}`);
});
