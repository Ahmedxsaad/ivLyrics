import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../SettingsStyles.js", import.meta.url), "utf8");
const start = source.indexOf("const SettingsWordmark =");
const end = source.indexOf("const SettingsCrumbs =", start);
assert.ok(start >= 0 && end > start);
const css = vm.runInNewContext(styles + "\nSETTINGS_MODAL_CSS;", { APP_NAME: "ivLyrics" });
const context = vm.createContext({ react: {
  createElement: (tag, props, ...children) => ({ tag, props, children }),
} });
vm.runInContext(source.slice(start, end) + "\nglobalThis.wordmark = SettingsWordmark();", context);

test("settings heading is a single accessible, left-to-right ivLyrics wordmark", () => {
  const title = context.wordmark;
  assert.equal(title.tag, "h1");
  assert.equal(title.props["aria-label"], "ivLyrics");
  assert.equal(title.props.dir, "ltr");
  assert.equal(title.children.map(part => part.children.join("")).join(""), "ivLyrics");
  assert.ok(title.children.every(part => part.props["aria-hidden"] === "true"));
  assert.match(source, /className: "settings-topbar-title"[\s\S]*?react\.createElement\(SettingsWordmark\)/);
});

test("brand segments use the requested 800 and 250 weights without added spacing", () => {
  assert.match(css, /\.settings-wordmark-iv\s*\{\s*font-weight: 800;/);
  assert.match(css, /\.settings-wordmark-lyrics\s*\{\s*font-weight: 250;/);
  assert.match(css, /\.settings-wordmark\s*\{[^}]*gap: 0;[^}]*direction: ltr;[^}]*unicode-bidi: isolate;/);
});
