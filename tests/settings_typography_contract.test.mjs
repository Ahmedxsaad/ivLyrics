import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const currentSource = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
// The released implementation is an independent oracle for the refactored controls.
const releasedSource = execFileSync("git", ["show", "98e6a4167c72f80b422ec77461852d9da12f97e9:Settings.js"], {
  cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
});

test("settings styles are bundled before their consumer", () => {
  const { subfiles } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(subfiles.filter(file => file === "SettingsStyles.js").length, 1);
  assert.ok(subfiles.indexOf("SettingsStyles.js") < subfiles.indexOf("Settings.js"));
});

const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
};

const createHarness = (source, config = {}, initialLanguage = "ko") => {
  const slots = [];
  const calls = [];
  const links = new Map();
  let cursor = 0;
  let language = initialLanguage;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => {
      slots[index] = typeof next === "function" ? next(slots[index]) : next;
    }];
  };
  const useMemo = (factory, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      slots[index] = { value: factory(), deps };
    }
    return slots[index].value;
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: Symbol.for("Fragment"), useState, useMemo,
    useCallback: (callback, deps) => useMemo(() => callback, deps),
    useRef: (current) => useMemo(() => ({ current }), []),
    useEffect: () => { cursor++; }, useLayoutEffect: () => { cursor++; },
  };
  const placeholders = Object.fromEntries([...source.matchAll(/^const (\w+) =/gm)].map(([, name]) => {
    const component = () => null;
    Object.defineProperty(component, "name", { value: name });
    return [name, component];
  }));
  const context = vm.createContext({
    ...placeholders, react, ...react, APP_NAME: "ivLyrics",
    CONFIG: { visual: { "line-spacing": 8, ...config } },
    I18n: { t: (key) => `${language}:${key}`, getAvailableLanguages: () => [] },
    Utils: { currentVersion: "test" },
    KaraokeLine: function KaraokeLine() {},
    window: { dispatchEvent: (event) => calls.push(["event", event.type, event.detail]) },
    document: {
      getElementById: (id) => links.get(id) || null,
      createElement: (type) => ({ type }),
      head: { appendChild: (link) => { links.set(link.id, link); calls.push(["appendFont", link.id]); } },
    },
    localStorage: { getItem: () => null },
    StorageManager: {
      getItem: () => null,
      setItem: (...args) => calls.push(["setItem", ...args]),
      saveConfig: (...args) => calls.push(["saveConfig", ...args]),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    syncSettingsLyricsPreviewStyles: () => calls.push(["preview"]),
    lyricContainerUpdate: () => calls.push(["lyrics"]),
    reloadLyrics: () => calls.push(["reload"]),
    getLyricsTypographyStyleVariables: () => ({}),
    GOOGLE_FONTS: ["Pretendard Variable", "Noto Sans", "Roboto"],
  });
  vm.runInContext(readFileSync(new URL("../SettingsStyles.js", import.meta.url), "utf8"), context);
  vm.runInContext([
    section(source, "const createTextOutlineSettingItems =", "const MULTI_VOCAL_COLOR_GROUPS ="),
    // Plain data the speaker-colour section reads while rendering.
    section(source, "const MULTI_VOCAL_COLOR_GROUPS =", "const getMultiVocalColorHelper ="),
    section(source, "const loadGoogleFontFamily =", "const SETTINGS_LYRICS_PREVIEW_TEXT ="),
    section(source, "const getEffectiveReducedMotionPreference =", "function openConfig("),
    "globalThis.ConfigModalUnderTest = ConfigModal;",
  ].join("\n"), context);
  return {
    context, calls, links,
    setLanguage(next) { language = next; },
    render(initialTab) { cursor = 0; return context.ConfigModalUnderTest({ initialTab }); },
  };
};

const elements = (node) => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("type" in node)) return [];
  return [node, ...elements(node.props.children)];
};

const normalize = (value) => {
  if (typeof value === "function") return `[function:${value.name}]`;
  if (typeof value === "symbol") return String(value);
  // The released oracle inlines its stylesheet. The new connection-only
  // rules intentionally extend the shared stylesheet without changing any
  // typography controls; retain the rest of the independent CSS/tree oracle.
  if (typeof value === "string") {
    return value.replace(/\/\* OpenAI-compatible connections share one editor and the settings controls\. \*\/[\s\S]*$/, "");
  }
  // The two requested LP controls are verified separately below. Keep the
  // released oracle for every existing setting and all typography behavior.
  if (Array.isArray(value)) return Array.from(value, normalize).filter(item =>
    !["fullscreen-vinyl-track-change-animation", "fullscreen-vinyl-rotation-speed"].includes(item?.key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, key.startsWith("on") && typeof item === "function" ? "[handler]" : normalize(item),
    ]));
  }
  return value;
};

const retiredFullscreenMarginKey = "fullscreen-lyrics-right-padding";

test("fullscreen no longer exposes the right-margin slider, including with a saved value", () => {
  for (const value of [undefined, 0, 280]) {
    const tree = createHarness(currentSource, { [retiredFullscreenMarginKey]: value }).render("fullscreen");
    const items = elements(tree).filter(element => element.type.name === "OptionList")
      .flatMap(element => element.props.items || []);
    assert.ok(items.length > 0, "fullscreen settings are rendered");
    assert.equal(items.some(item => item.key === retiredFullscreenMarginKey), false);
  }
});

// The redesigned window shows the lyric typography of every layer in one
// table (SettingsLayerMatrix) instead of one section per layer. The released
// build stays the oracle for what each control is and does: the same keys,
// item definitions and defaults, and the same storage, preview, font, reload
// and event side effects. Only the layout around the controls changed.
const TYPOGRAPHY_KEY = /^(?:fullscreen-vinyl-)?(?:original|phonetic|translation)-/;
// The released page built one font row per layer by hand (a nameless
// ConfigFontSelector); they map, in order, to these keys.
const RELEASED_FONT_ROW_KEYS = ["original-font-family", "phonetic-font-family", "translation-font-family"];

const typographyControls = (tree) => {
  let fontRow = 0;
  return elements(tree).flatMap((element) => {
    if (element.type.name === "OptionList") {
      return (element.props.items || []).filter((item) => TYPOGRAPHY_KEY.test(item.key))
        .map((item) => ({ key: item.key, onChange: item.onChange || element.props.onChange, item }));
    }
    if (element.type.name === "SettingsLayerMatrix") {
      return element.props.columns.flatMap((column) => column.items
        .filter((item) => TYPOGRAPHY_KEY.test(item.key))
        .map((item) => ({ key: item.key, onChange: column.onChange || element.props.onChange, item })));
    }
    if (element.type.name === "ConfigFontSelector" && element.props.name === "") {
      const key = RELEASED_FONT_ROW_KEYS[fontRow++];
      return [{ key, onChange: element.props.onChange, item: { key, type: element.type, defaultValue: element.props.defaultValue }, fontRow: true }];
    }
    return [];
  });
};

const controlMap = (controls) => {
  const map = new Map();
  for (const control of controls) {
    assert.equal(map.has(control.key), false, control.key + " is rendered once");
    map.set(control.key, control);
  }
  return map;
};

// What a control is, without its handlers: label, help, type, range, unit,
// options and default. Font rows of the released page carried only a type and
// a default, so those are what is compared for them.
const definition = (control, fontRowShape) => {
  const { item } = control;
  if (fontRowShape) return normalize({ key: item.key, type: item.type, defaultValue: item.defaultValue });
  const fields = {};
  for (const [name, value] of Object.entries(item)) {
    if (typeof value === "function" && name !== "type") continue;
    if (value === undefined) continue;
    fields[name] = value;
  }
  return normalize(fields);
};

test("LP transition and speed controls persist and notify the active renderer", () => {
  const h = createHarness(currentSource);
  const controls = elements(h.render("fullscreen"))
    .filter(node => node.type.name === "OptionList")
    .flatMap(node => (node.props.items || []).map(item => ({ item, save: node.props.onChange })));
  const transition = controls.find(({ item }) => item.key === "fullscreen-vinyl-track-change-animation");
  const speed = controls.find(({ item }) => item.key === "fullscreen-vinyl-rotation-speed");
  assert.equal(transition.item.defaultValue, true);
  assert.equal(speed.item.defaultValue, 100);
  assert.deepEqual([speed.item.min, speed.item.max, speed.item.step, speed.item.unit], [25, 200, 5, "%"]);
  for (const [control, value] of [[transition, false], [speed, 175]]) {
    h.calls.length = 0;
    control.save(control.item.key, value);
    assert.equal(h.context.CONFIG.visual[control.item.key], value);
    assert.deepEqual(normalize(h.calls), [
      ["saveConfig", control.item.key, value],
      ["lyrics"],
      ["event", "ivLyrics", { type: "config", name: control.item.key, value }],
    ]);
  }
});

for (const tab of ["appearance", "fullscreen"]) {
  test(`${tab} typography keeps the released controls, definitions, defaults, and language updates`, () => {
    for (const value of [undefined, null, false, 0, "", 27, "Roboto"]) {
      const config = {};
      for (const prefix of ["original", "phonetic", "translation", "fullscreen-vinyl-original", "fullscreen-vinyl-phonetic", "fullscreen-vinyl-translation"]) {
        for (const suffix of ["font-family", "font-size", "font-weight", "opacity", "spacing", "letter-spacing", "outline-width", "outline-color"]) {
          config[`${prefix}-${suffix}`] = value;
        }
      }
      const before = createHarness(releasedSource, config);
      const after = createHarness(currentSource, config);
      const compare = () => {
        const released = controlMap(typographyControls(before.render(tab)));
        const current = controlMap(typographyControls(after.render(tab)));
        assert.ok(released.size >= 20, "released typography controls found");
        assert.deepEqual([...current.keys()].sort(), [...released.keys()].sort(), "same typography keys");
        for (const [key, control] of released) {
          assert.deepEqual(definition(current.get(key), control.fontRow), definition(control, control.fontRow), key + ": definition");
        }
      };
      compare();
      const first = after.render(tab);
      assert.deepEqual(elements(after.render(tab)).map((element) => element.type), elements(first).map((element) => element.type));
      before.setLanguage("zh-TW");
      after.setLanguage("zh-TW");
      compare();
    }
  });

  test(`${tab} typography retains storage, preview, font, reload, and event side effects`, () => {
    const baseline = createHarness(releasedSource);
    const candidate = createHarness(currentSource);
    const oldControls = typographyControls(baseline.render(tab));
    const newControls = controlMap(typographyControls(candidate.render(tab)));
    assert.ok(oldControls.length >= 20);
    assert.equal(newControls.size, oldControls.length);
    for (const oldControl of oldControls) {
      const key = oldControl.key;
      const newControl = newControls.get(key);
      assert.ok(newControl, key + " is still rendered");
      const values = key.endsWith("font-family")
        ? ["'Noto Sans', Pretendard Variable, unknown", "Roboto", "Roboto", ""]
        : key === "phonetic-hyphen-replace" ? ["keep", "space", "remove"] : [0, 2, false];
      for (const value of values) {
        oldControl.onChange(key, value);
        newControl.onChange(key, value);
        assert.deepEqual(normalize(candidate.calls), normalize(baseline.calls), `${key}: calls`);
        assert.deepEqual(normalize(candidate.context.CONFIG), normalize(baseline.context.CONFIG), `${key}: config`);
        assert.deepEqual(normalize([...candidate.links]), normalize([...baseline.links]), `${key}: font links`);
      }
    }
  });
}
