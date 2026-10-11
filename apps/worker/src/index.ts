// Placeholder entry point. The cron loop, Gmail sync and /health server arrive in Phase 5.
import { CATEGORIES } from "@alarm/core";

console.log(`[worker] scaffold ready (categories: ${CATEGORIES.join(", ")})`);
