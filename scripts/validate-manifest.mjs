import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.default_locale, "en");
const catalogs = await Promise.all(["en", "ko"].map(async (locale) =>
  JSON.parse(await readFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url), "utf8"))));
assert.deepEqual(Object.keys(catalogs[0]).sort(), Object.keys(catalogs[1]).sort(), "Locale catalogs must have the same keys");
for (const key of Object.keys(catalogs[0])) {
  for (const catalog of catalogs) assert.ok(catalog[key].message.trim(), `${key} must have a translation`);
  assert.deepEqual(catalogs[0][key].message.match(/\$\d+/g) || [], catalogs[1][key].message.match(/\$\d+/g) || [], `${key} placeholders must agree`);
}
for (const value of [manifest.description, manifest.action.default_title]) {
  assert.ok(catalogs[0][value.match(/^__MSG_(\w+)__$/)?.[1]], "Manifest locale key must exist");
}
for (const file of ["src/content.js", "src/meter-ui.js", "src/options/options.js", "src/options/options.html",
  "src/exporters/fresh.js", "src/exporters/display-markup.js", "src/exporters/markdown.js", "src/exporters/html.js", "src/viewer/viewer.js"]) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of source.matchAll(/\bt\("([\w]+)"|data-i18n="([\w]+)"/g)) {
    assert.ok(catalogs[0][match[1] || match[2]], `${file} locale key must exist: ${match[1] || match[2]}`);
  }
}
const optionsHtml = await readFile(new URL("../src/options/options.html", import.meta.url), "utf8");
assert.ok(optionsHtml.indexOf("../i18n.js") < optionsHtml.indexOf("options.js"), "Options must register i18n before use");
assert.deepEqual(manifest.permissions, ["storage"], "Only local export preferences need an API permission");
assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "64", "96", "128"]);
assert.deepEqual(Object.keys(manifest.action.default_icon), ["16", "32", "64"]);
for (const icons of [manifest.icons, manifest.action.default_icon]) {
  for (const [size, file] of Object.entries(icons)) {
    const png = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} must be a PNG`);
    assert.equal(png.readUInt32BE(16), Number(size), `${file} width must match its size`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} height must match its size`);
    assert.equal(png[25], 6, `${file} must retain RGBA transparency`);
  }
}
assert.equal(manifest.web_accessible_resources, undefined, "Viewer is not exposed to websites");
assert.deepEqual(manifest.background.scripts, ["src/view-background.js"]);
for (const file of [...manifest.background.scripts, "src/viewer/viewer.html", "src/viewer/viewer.js", "src/viewer/viewer.css"]) {
  await access(new URL(`../${file}`, import.meta.url));
}
const viewerHtml = await readFile(new URL("../src/viewer/viewer.html", import.meta.url), "utf8");
assert.ok(viewerHtml.indexOf("../i18n.js") < viewerHtml.indexOf("viewer.js"));
assert.equal(manifest.action.default_popup, "src/options/options.html");
assert.equal(manifest.options_ui.page, manifest.action.default_popup);
for (const file of [manifest.action.default_popup, "src/i18n.js", "src/options/options.js", "src/options/options.css"]) {
  await access(new URL(`../${file}`, import.meta.url));
}
assert.deepEqual(manifest.host_permissions, [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
]);
assert.deepEqual(
  manifest.browser_specific_settings.gecko.data_collection_permissions.required,
  ["none"],
  "The extension must declare that it does not transmit collected data",
);

for (const entry of manifest.content_scripts) {
  for (const relativePath of [...(entry.js || []), ...(entry.css || [])]) {
    await access(new URL(`../${relativePath}`, import.meta.url));
  }
  validateContentScriptDependencies(entry);
}

export function validateContentScriptDependencies(entry) {
  const dependencies = {
    "src/exporters/json.js": ["src/model.js"],
    "src/exporters/display-markup.js": ["src/i18n.js", "src/vendor/marked.umd.js"],
    "src/exporters/markdown.js": ["src/i18n.js", "src/model.js", "src/exporters/display-markup.js"],
    "src/exporters/html.js": ["src/i18n.js", "src/model.js", "src/exporters/display-markup.js"],
    "src/adapters/chatgpt-api.js": ["src/model.js"],
    "src/adapters/chatgpt-dom.js": ["src/model.js"],
    "src/conversation-snapshot.js": ["src/adapters/chatgpt-api.js", "src/adapters/chatgpt-dom.js", "src/refresh-policy.js"],
    "src/exporters/fresh.js": ["src/i18n.js", "src/conversation-snapshot.js", "src/exporters/common.js", "src/exporters/markdown.js", "src/exporters/json.js", "src/exporters/html.js", "src/exporters/zip.js"],
    "src/meter-ui.js": ["src/i18n.js", "src/ui-position.js"],
    "src/document-viewer.js": [],
    "src/content.js": ["src/i18n.js", "src/model.js", "src/export-settings.js", "src/adapters/chatgpt-api.js", "src/adapters/chatgpt-dom.js", "src/refresh-policy.js", "src/conversation-snapshot.js", "src/exporters/fresh.js", "src/meter-ui.js", "src/document-viewer.js"],
  };
  for (const [consumer, required] of Object.entries(dependencies)) {
    const index = entry.js.indexOf(consumer);
    assert.ok(index >= 0, `${consumer} must be registered`);
    for (const dependency of required) {
      assert.ok(entry.js.indexOf(dependency) >= 0 && entry.js.indexOf(dependency) < index,
        `${dependency} must load before ${consumer}`);
    }
  }
}

console.log("manifest.json is valid and all referenced files exist");
