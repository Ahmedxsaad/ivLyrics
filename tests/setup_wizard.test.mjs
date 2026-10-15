import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../SetupWizard.js", import.meta.url), "utf8");

// Exercise the real wizard's buttons and storage with a small hook renderer.
// Browser validation covers the actual DOM, layout and keyboard navigation separately.
function harness({ stored = {}, visual = {} } = {}) {
  const storage = new Map(Object.entries(stored));
  const config = { visual: { language: "ko", alignment: "right", "translate:target-language": "auto",
    "panel-lyrics-enabled": false, ...visual } };
  const hooks = [];
  let cursor = 0;
  let language = "ko";
  let completed = 0;
  let domTheme = "dark";
  const state = (initial) => {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
    return [hooks[index], (next) => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }];
  };
  const context = vm.createContext({
    window: {},
    CONFIG: config,
    SETTINGS_LYRICS_PREVIEW_TEXT: "sample",
    I18n: {
      getCurrentLanguage: () => language,
      getAvailableLanguages: () => [{ code: "ko", name: "Korean" }, { code: "en", name: "English" }],
      setLanguage: (value) => { language = value; },
      t: (key) => key,
    },
    StorageManager: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      saveConfig: (key, value) => storage.set("ivLyrics:visual:" + key, String(value)),
    },
    getSettingsSurfaceTheme: () => storage.get("ivLyrics:settings-ui-theme") === "light" ? "light" : "dark",
    handleSettingsRadioKeys() {},
    setTimeout() {},
    react: {
      memo: (fn) => fn,
      createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
      useEffect() {},
      useRef: (initial) => state({ current: initial })[0],
    },
    useState: state,
  });
  context.window.CONFIG = config;
  vm.runInContext(source + "\nglobalThis.Wizard = SetupWizard;", context);
  const render = () => {
    cursor = 0;
    return context.Wizard({ onComplete: () => completed++, onThemeChange: (theme) => { domTheme = theme; } });
  };
  const flatten = (node, result = []) => {
    if (!node || typeof node !== "object") return result;
    if (typeof node.type === "function") return flatten(node.type(node.props), result);
    result.push(node);
    for (const child of node.props.children || []) flatten(child, result);
    return result;
  };
  const click = (key) => {
    const node = flatten(render()).find((item) => item.type === "button" && item.props.children?.includes(key));
    assert.ok(node, "missing button " + key);
    node.props.onClick();
  };
  return { render, flatten, click, config, storage, completed: () => completed, domTheme: () => domTheme };
}

test("reopening and finishing preserves disabled backgrounds and the persisted overlay setting", () => {
  const h = harness({ stored: { "ivLyrics:overlay-enabled": "true" } });
  h.click("setupWizard.quick.playback");
  const switches = h.flatten(h.render()).filter((node) => node.props.role === "switch");
  assert.equal(switches[0].props["aria-checked"], false, "disabled panel stays disabled");
  assert.equal(switches[1].props["aria-checked"], true, "overlay reads its actual persistence key");
  h.click("setupWizard.complete.startNow");
  assert.equal(h.completed(), 1);
  assert.equal(h.storage.get("ivLyrics:overlay-enabled"), "true");
  assert.equal(h.storage.get("ivLyrics:visual:gradient-background"), "false");
  assert.equal(h.storage.get("ivLyrics:visual:alignment"), "right");
  assert.equal(h.storage.get("ivLyrics:setup-completed"), "true");
});

test("choosing a theme previews it without committing it before completion", () => {
  const h = harness({ stored: { "ivLyrics:settings-ui-theme": "auto" } });
  const light = h.flatten(h.render()).find((node) => node.props["aria-label"] === "settingsUi.theme.light");
  light.props.onClick();
  assert.equal(h.domTheme(), "light");
  assert.equal(h.storage.get("ivLyrics:settings-ui-theme"), "auto");
  assert.equal(h.storage.has("ivLyrics:setup-completed"), false);
  h.click("setupWizard.quick.playback");
  h.click("setupWizard.complete.startNow");
  assert.equal(h.storage.get("ivLyrics:settings-ui-theme"), "light");
});

test("returning to a previous page keeps draft choices and completion writes them once", () => {
  const h = harness({ visual: { "gradient-background": true } });
  h.click("setupWizard.quick.appearance");
  const background = h.flatten(h.render()).find((node) => node.props.role === "radio" && node.props.children?.includes("setupWizard.theme.backgrounds.video"));
  background.props.onClick();
  h.click("setupWizard.quick.language");
  h.click("setupWizard.quick.appearance");
  const selected = h.flatten(h.render()).filter((node) => node.props.role === "radio" && node.props["aria-checked"]);
  assert.ok(selected.some((node) => node.props.children?.includes("setupWizard.theme.backgrounds.video")));
  assert.equal(h.storage.has("ivLyrics:setup-completed"), false);
  h.click("setupWizard.quick.playback");
  h.click("setupWizard.complete.startNow");
  h.click("setupWizard.complete.startNow");
  assert.equal(h.completed(), 1);
  assert.equal(h.storage.get("ivLyrics:visual:video-background"), "true");
  assert.equal(h.storage.get("ivLyrics:visual:gradient-background"), "false");
});

