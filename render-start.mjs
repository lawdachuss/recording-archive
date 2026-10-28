import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const publicPort = process.env.PORT || "3000";
const apiPort = process.env.API_PORT || "8080";
const children = [];
let shuttingDown = false;

function launch(name, args, env) {
  const child = spawn(pnpm, args, {
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
  `[render-start] Starting API on 127.0.0.1:${apiPort} and frontend on port ${publicPort}.`,
);

// The API server is bundled during the root build. It listens only on the
// internal port; the frontend's Vite preview server owns Render's public PORT.
launch(
  "api-server",
  ["--filter", "@workspace/api-server", "run", "start"],
  { NODE_ENV: "production", PORT: apiPort },
);

launch(
  "video-archive",
  ["--filter", "@workspace/video-archive", "run", "serve"],
  {
    NODE_ENV: "production",
    PORT: publicPort,
    FRONTEND_PORT: publicPort,
  },
);
