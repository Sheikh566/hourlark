import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const statePath = await mkdtemp(path.join(tmpdir(), "hourlark-e2e-"));
const env = {
  ...process.env,
  HOURLARK_E2E_STATE: statePath,
  WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? path.join(statePath, "logs"),
};
let child;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

async function run(args) {
  if (stopping) throw new Error("Browser test server stopped.");
  await new Promise((resolve, reject) => {
    child = spawn("pnpm", ["exec", ...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || stopping) resolve();
      else reject(new Error(`${args[0]} exited with ${signal ?? code}.`));
    });
  });
}

try {
  console.log(`Browser test D1 state: ${statePath}`);
  await run(["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", statePath]);
  await run([
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    statePath,
    "--file",
    "seeds/development.sql",
  ]);
  await run([
    "vite",
    "--config",
    "scripts/vite.e2e.mjs",
    "--host",
    "127.0.0.1",
    "--port",
    "5186",
    "--strictPort",
  ]);
} finally {
  await rm(statePath, { recursive: true, force: true });
}
