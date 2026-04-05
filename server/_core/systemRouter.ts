import { publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure.query(() => ({ status: "ok", timestamp: Date.now() })),
});
