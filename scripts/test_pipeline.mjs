import { runGuestMessagePipeline } from "./server/taskCreator.ts";

console.log("[Test] Starting guest message pipeline...");
try {
  const result = await runGuestMessagePipeline();
  console.log("[Test] Pipeline result:", JSON.stringify(result, null, 2));
} catch (err) {
  console.error("[Test] Pipeline failed:", err);
}
process.exit(0);
