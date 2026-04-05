import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerOAuthRoutes } from "./oauth";
import { registerGoogleAuthRoutes } from "../googleAuth";
import { setupVite, serveStatic } from "./vite";
import { startCronJobs } from "../cron";
import { stripeWebhookRouter } from "../stripeWebhook";

// Webhook router uses raw body parsing — must import default Router export
import webhookRouterModule from "../webhooks";

const app = express();
const server = createServer(app);

const PORT = Number(process.env.PORT) || 5000;
const isDev = process.env.NODE_ENV !== "production";

async function startServer() {
  // Stripe webhooks need raw body — mount BEFORE json middleware
  app.use("/api/stripe", express.raw({ type: "application/json" }), stripeWebhookRouter);

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
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on port ${PORT} (${isDev ? "development" : "production"})`);

    // Start background cron jobs
    startCronJobs();
  });
}

startServer().catch(console.error);
