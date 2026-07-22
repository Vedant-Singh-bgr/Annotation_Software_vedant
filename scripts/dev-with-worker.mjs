// Launch the Next dev server AND the transcode worker together, so queued
// transcodes are always processed. Both read .env on their own (Next natively;
// the worker via its load_dotenv). Ctrl+C stops both.
import { spawn } from "node:child_process";

const opts = { stdio: "inherit", shell: true };
console.log("▶ starting Next dev + transcode worker (Ctrl+C to stop both)…");

const next = spawn("next dev", [], opts);
const worker = spawn(`${process.env.PYTHON_BIN || "python"} scripts/transcode_worker.py`, [], opts);

const killAll = () => {
  try { next.kill(); } catch {}
  try { worker.kill(); } catch {}
};
process.on("SIGINT", () => { killAll(); process.exit(0); });
process.on("exit", killAll);
next.on("exit", (c) => console.log(`[next] exited ${c}`));
worker.on("exit", (c) => console.log(`[worker] exited ${c} — transcodes will queue until restarted`));
