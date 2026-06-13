import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dir = path.dirname(fileURLToPath(import.meta.url));

build({
  entryPoints: [path.resolve(dir, "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.resolve(dir, "index.mjs"),
  logLevel: "info",
  sourcemap: false,
  banner: {
    js: [
      `import { createRequire as __req } from 'node:module';`,
      `import __path from 'node:path';`,
      `import __url from 'node:url';`,
      `globalThis.require = __req(import.meta.url);`,
      `globalThis.__filename = __url.fileURLToPath(import.meta.url);`,
      `globalThis.__dirname = __path.dirname(globalThis.__filename);`,
    ].join("\n"),
  },
}).catch((e) => { console.error(e); process.exit(1); });
