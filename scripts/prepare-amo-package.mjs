import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Stage only runtime files for web-ext lint/build. Never include development data.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist", "amo", "runtime");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const files = [...new Set([
  "manifest.json", "LICENSE", ...Object.values(manifest.icons),
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap(entry => [...entry.js, ...entry.css]),
  manifest.options_ui.page, "src/options/options.js", "src/options/options.css",
  "src/viewer/viewer.html", "src/viewer/viewer.js", "src/viewer/viewer.css",
  "src/vendor/README.md", "src/vendor/marked.LICENSE.md",
  "_locales/en/messages.json", "_locales/ko/messages.json",
])].sort();
async function rejectLinks(absolute) {
  let current = root;
  if ((await lstat(current)).isSymbolicLink()) throw new Error("Workspace root must not be a link");
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Links are not allowed: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      break;
    }
  }
}
const entries = [];
for (const file of files) {
  if (path.isAbsolute(file) || file.includes("\\") || file.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe relative path: ${file}`);
  }
  const source = path.join(root, file);
  await rejectLinks(source);
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${file}`);
  entries.push({ file, content: await readFile(source) });
}
await rejectLinks(output);
await mkdir(path.dirname(output), { recursive: true });
// An existing folder may contain a release candidate. Do not overwrite it.
await mkdir(output);
const hashes = {};
const digest = content => createHash("sha256").update(content).digest("hex");
for (const { file, content } of entries) {
  const target = path.join(output, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { flag: "wx" });
  hashes[file] = digest(content);
  if (digest(await readFile(target)) !== hashes[file]) throw new Error(`Copy mismatch: ${file}`);
}
await writeFile(path.join(path.dirname(output), "runtime-files.json"), JSON.stringify({
  version: manifest.version, id: manifest.browser_specific_settings.gecko.id, hashes,
}, null, 2) + "\n", { flag: "wx" });
console.log(`Staged ${files.length} files for ${manifest.name} ${manifest.version} (${manifest.browser_specific_settings.gecko.id})`);
console.log("Run web-ext lint and web-ext build with --source-dir dist/amo/runtime.");
