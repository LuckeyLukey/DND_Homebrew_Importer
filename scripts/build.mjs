import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "src");
const dist = join(root, "dist");

const files = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "content.js"
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  await copyFile(join(src, file), join(dist, file));
}

console.log(`Built extension into ${dist}`);
