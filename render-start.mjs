import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const publicPort = process.env.PORT || "3000";
const apiPort = process.env.API_PORT || "8080";
const children = [];
let shuttingDown = false;

function launch(name, args, cwd, env) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push({ name, child });

  child.on("error", (error) => {
    console.error(`[render-start] Failed to launch ${name}:`, error);
    stop(1);
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[render-start] ${name} exited unexpectedly (code=${code}, signal=${signal}).`,
      );
      stop(code ?? 1);
    }
  });

  return child;
}

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  process.exitCode = exitCode;
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

console.log(
  `[render-start] Starting API on port ${apiPort} and frontend on port ${publicPort}.`,
);

// Use npm scripts from each workspace package. npm is guaranteed to be
// available because Render invokes this root script using npm run dev.
launch(
  "api-server",
  ["run", "start"],
  path.join(repoRoot, "artifacts", "api-server"),
  { NODE_ENV: "production", PORT: apiPort, HOST: "127.0.0.1" },
);

launch(
  "video-archive",
  ["run", "serve"],
  path.join(repoRoot, "artifacts", "video-archive"),
  {
    NODE_ENV: "production",
    PORT: publicPort,
    FRONTEND_PORT: publicPort,
  },
);
