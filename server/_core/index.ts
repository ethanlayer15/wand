import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerOAuthRoutes } from "./oauth";
import { registerGoogleAuthRoutes } from "../googleAuth";
import { startCronJobs } from "../cron";
import { stripeWebhookRouter } from "../stripeWebhook";
import { registerSlackAgentRoutes } from "../agents/slackApp";

// Webhook router uses raw body parsing — must import default Router export
import webhookRouterModule from "../webhooks";

const app = express();
const server = createServer(app);

const PORT = Number(process.env.PORT) || 5000;
const isDev = process.env.NODE_ENV !== "production";

async function startServer() {
  // Stripe webhooks need raw body — mount BEFORE json middleware
  app.use("/api/stripe", express.raw({ type: "application/json" }), stripeWebhookRouter);

  // Slack agent endpoints (Wanda, Starry) need raw body for signature verification.
  // Must also be mounted BEFORE express.json().
  registerSlackAgentRoutes(app);

  // Standard JSON body parser for everything else
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  // OAuth routes (Manus legacy + Google GSuite)
  registerOAuthRoutes(app);
  registerGoogleAuthRoutes(app);

  // Breezeway / Hostaway webhook routes
  app.use("/api/webhooks", webhookRouterModule);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Vite dev server (HMR) or static file serving
  if (isDev) {
    // Dynamic import so vite is not required in production
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    // Serve static files in production
    const distPath = path.resolve(import.meta.dirname, "public");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath, { maxAge: "1y", immutable: true }));
      app.use("*", (_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
      });
    } else {
      console.error(`[Server] Static files not found at ${distPath}`);
    }
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on port ${PORT} (${isDev ? "development" : "production"})`);

    // Start background cron jobs
    startCronJobs();
  });
}

startServer().catch(console.error);
