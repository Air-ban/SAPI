import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPlaygroundRoot = resolve(repoRoot, "..", "gpt_image_playground");
const playgroundRoot = resolve(process.env.SAPI_IMAGE_PLAYGROUND_ROOT || defaultPlaygroundRoot);
const distDir = resolve(playgroundRoot, "dist");
const targetDir = resolve(repoRoot, "client", "public", "image-playground");
const publicDir = resolve(repoRoot, "client", "public");

if (!existsSync(resolve(playgroundRoot, "package.json"))) {
  throw new Error(`gpt_image_playground not found: ${playgroundRoot}`);
}

const buildCommand = process.platform === "win32"
  ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm run build"] }
  : { command: "npm", args: ["run", "build"] };
const build = spawnSync(buildCommand.command, buildCommand.args, {
  cwd: playgroundRoot,
  stdio: "inherit",
  shell: false
});

if (build.status !== 0) {
  if (build.error) {
    console.error(build.error);
  }
  if (build.signal) {
    console.error(`gpt_image_playground build stopped by signal ${build.signal}`);
  }
  process.exit(build.status || 1);
}

if (!existsSync(resolve(distDir, "index.html"))) {
  throw new Error(`gpt_image_playground build output missing: ${distDir}`);
}

if (!targetDir.startsWith(publicDir)) {
  throw new Error(`Refusing to write outside client/public: ${targetDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(distDir, targetDir, { recursive: true });

console.log(`Synced gpt_image_playground to ${targetDir}`);
