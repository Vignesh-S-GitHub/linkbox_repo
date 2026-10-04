import { spawn } from "node:child_process";
import process from "node:process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Start LinkBox with npm run dev.");
const children = [];
let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill();
}
for (const workspace of ["@temporary-share/worker", "@temporary-share/web"]) {
  const child = spawn(process.execPath, [npmCli, "run", "dev", `--workspace=${workspace}`], {
    stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  children.push(child);
  child.on("error", error => { console.error(`Could not start ${workspace}: ${error.message}`); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 1); });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
