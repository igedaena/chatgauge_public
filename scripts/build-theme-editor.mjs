import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const sources = ["tools/theme-editor/preview-environment.js", "src/theme-contract.js", "src/exporters/zip.js", "src/theme-package.js", "src/meter-ui.js",
  "tools/theme-editor/editor-model.js", "tools/theme-editor/editor-recovery.js", "tools/theme-editor/editor.js"];

// Shared app files are read at build time only. The downloadable HTML needs no extension or server.
export async function renderThemeEditor(root = project) {
  const read = file => readFile(path.join(root, file), "utf8");
  const [template, css, theme, png, scripts, locales, license] = await Promise.all([
    read("tools/theme-editor/editor.html"), read("tools/theme-editor/editor.css"),
    read("src/themes/default-sample.json").then(JSON.parse), readFile(path.join(root, "src/themes/default-sample.png")),
    Promise.all(sources.map(read)),
    Promise.all(["en", "ko"].map(async locale => [locale, {
      ...JSON.parse(await read(`_locales/${locale}/messages.json`)),
      ...JSON.parse(await read(`tools/theme-editor/locales/${locale}.json`)),
    }])),
    read("LICENSE"),
  ]);
  const data = JSON.stringify({ theme, png: png.toString("base64"), locales: Object.fromEntries(locales) }).replaceAll("<", "\\u003c");
  let html = template.replace("<!doctype html>", () => `<!doctype html>\n<!--\nChatGauge theme editor — project license\n${license.replaceAll("-->", "-- >")}\n-->`)
    .replace('<link rel="stylesheet" href="editor.css">', `<style>\n${css}\n</style>`)
    .replace("EDITOR_BUNDLE_DATA", () => data);
  const tags = [...html.matchAll(/<script src="[^"]+"><\/script>/g)];
  if (tags.length !== scripts.length) throw new Error("Standalone editor script list does not match the template");
  for (let i = 0; i < tags.length; i++) html = html.replace(tags[i][0], () => `<script>\n${scripts[i].replaceAll("</script", "<\\/script")}\n</script>`);
  if (/<script\s+src=|<link\s+[^>]*href=|EDITOR_BUNDLE_DATA/.test(html)) throw new Error("Standalone editor has unresolved assets");
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.join(project, "dist", "theme-editor"), filename = "chatgauge-theme-editor.html";
  const html = await renderThemeEditor();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), html);
  const hash = createHash("sha256").update(html).digest("hex");
  await writeFile(path.join(directory, `${filename}.sha256`), `${hash}  ${filename}\n`);
  console.log(`Standalone editor: ${path.join(directory, filename)} (${Buffer.byteLength(html)} bytes)`);
}
