import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing production section: ${start}`);
  return source.slice(from, to);
};
const elements = (node) => Array.isArray(node) ? node.flatMap(elements)
  : node?.props ? [node, ...elements(node.props.children)] : [];
const find = (tree, predicate) => {
  const node = elements(tree).find(predicate);
  assert.ok(node, "expected control in the production element tree");
  return node;
};

// Preserve real hook dependencies and flush effects after attaching host refs.
// Only the host environment is faked; the controls and save handlers below
// are evaluated directly from Settings.js.
function harness(code, component, globals = {}) {
  const slots = [], effects = [], calls = [], listeners = new Map(), frames = new Map();
  let cursor = 0, frameId = 0;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => {
      slots[index] = typeof next === "function" ? next(slots[index]) : next;
    }];
  };
  const useRef = (current) => {
    const index = cursor++;
    return slots[index] ??= { current };
  };
  const changed = (before, after) => !before || !after
    || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  const useMemo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  };
  const useEffect = (effect, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || changed(previous.deps, deps)) {
      slots[index] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
    }
  };
  const react = {
    useState, useRef, useMemo, useEffect,
    useCallback: (callback, deps) => useMemo(() => callback, deps),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const context = vm.createContext({
    ...react, react,
    CONFIG: { visual: {} }, APP_NAME: "ivLyrics",
    document: { activeElement: null },
    window: {
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      },
      removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
      dispatchEvent: (event) => calls.push(["event", event.type, { ...event.detail }]),
    },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    getSettingsText: (_key, fallback) => fallback,
    getComputedStyle: () => ({ marginTop: "12px" }),
    performance: { now: () => 1000 },
    hasSettingDefault: () => false,
    isSettingChanged: () => false,
    useSettingsConfigRevision: () => 0,
    useSettingsSignal: (signal) => signal?.get(),
    SettingsUiIcon: function SettingsUiIcon() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    StorageManager: {
      saveConfig: (...args) => calls.push(["saveConfig", ...args]),
      setItem: (...args) => calls.push(["setItem", ...args]),
    },
    loadGoogleFontFamily() {},
    syncSettingsLyricsPreviewStyles: () => calls.push(["preview"]),
    lyricContainerUpdate: () => calls.push(["lyrics"]),
    reloadLyrics: (...args) => calls.push(["reloadLyrics", ...args]),
    ...globals,
  });
  vm.runInContext(`${code}\nglobalThis.component = ${component};`, context);
  return {
    context, calls, listeners, frames,
    render(props = {}, attach = () => {}) {
      cursor = 0;
      const tree = context.component(props);
      attach(tree);
      effects.splice(0).forEach((effect) => effect());
      return tree;
    },
    fire: (type) => [...(listeners.get(type) || [])].forEach((callback) => callback({ type })),
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}

const compareCode = section("const normalizeSettingComparable =", "const getCurrentSettingValue =");
const numericCode = [
  compareCode,
  section("const getSettingsStepDecimals =", "const SETTINGS_CUSTOM_FONT_OPTION ="),
  section("const ConfigSliderRange =", "const normalizeSettingsHexColor ="),
  section("  const saveLyricsTypographySetting =", "  const saveVinylSetting ="),
  "globalThis.saveTypography = saveLyricsTypographySetting;",
].join("\n");
const pointer = (type, extra = {}) => ({
  type, pointerId: 7, button: 0, clientX: 0,
  preventDefault() {}, currentTarget: { setPointerCapture() {} }, ...extra,
});

function numericHarness(component, overrides = {}) {
  const h = harness(numericCode, component);
  const commits = [];
  let props = {
    value: 44, defaultValue: 44, min: 12, max: 200, step: 2, unit: "px", name: "Size", label: "Size",
    onChange(value) {
      commits.push(value);
      h.context.saveTypography("original-font-size", value);
    },
    ...overrides,
  };
  const inputHost = { focus() { h.context.document.activeElement = this; }, select() {}, dataset: {} };
  const render = (next = {}) => {
    props = { ...props, ...next };
    return h.render(props, (tree) => {
      const input = elements(tree).find((node) => node.type === "input" && node.props.ref);
      if (input) input.props.ref.current = inputHost;
    });
  };
  const control = (tree) => component === "SettingsScrubField" ? tree
    : find(tree, (node) => node.type === "input" && node.props.type === "range");
  const shown = (tree) => find(tree, (node) => node.type === "input").props.value;
  const start = () => control(render()).props.onPointerDown(pointer("pointerdown"));
  const move = (value, extra = {}) => {
    const node = control(render());
    if (component === "SettingsScrubField") node.props.onPointerMove(pointer("pointermove", { clientX: value, ...extra }));
    else node.props.onChange({ target: { value: String(value) } });
  };
  return { ...h, commits, inputHost, render, control, shown, start, move };
}

for (const component of ["SettingsScrubField", "ConfigSliderRange"]) {
  test(`${component}: pointer motion stays local and release saves once through the production handler`, () => {
    const h = numericHarness(component);
    h.start();
    for (let value = 50; value <= 100; value++) h.move(value);
    const tree = h.render();
    const final = Number(h.shown(tree));
    assert.notEqual(final, 44, "the displayed value follows the drag");
    assert.deepEqual(h.commits, []);
    assert.deepEqual(h.calls, [], "no storage, preview, lyrics, or config work per movement");
    h.control(tree).props.onPointerUp(pointer("pointerup", { pointerId: 8 }));
    assert.deepEqual(h.commits, [], "another pointer cannot finish this drag");
    h.control(tree).props.onPointerUp(pointer("pointerup"));
    h.control(h.render()).props.onLostPointerCapture(pointer("lostpointercapture"));
    assert.deepEqual(h.commits, [final]);
    assert.equal(h.context.CONFIG.visual["original-font-size"], final);
    assert.deepEqual(h.calls.map(([type]) => type), ["setItem", "preview", "lyrics", "event"]);
    assert.deepEqual(h.calls[0], ["setItem", "ivLyrics:visual:original-font-size", final]);
    assert.deepEqual(h.calls[3], ["event", "ivLyrics", { type: "config", name: "original-font-size", value: final }]);
    h.unmount();
  });

  test(`${component}: cancellation, focus loss, disabling, external reset and unmount discard drafts`, () => {
    for (const stop of ["onPointerCancel", "onLostPointerCapture", "blur", "disabled", "reset", "unmount"]) {
      const h = numericHarness(component);
      h.start(); h.move(120);
      if (stop === "blur") h.fire("blur");
      else if (stop === "disabled") h.render({ disabled: true });
      else if (stop === "reset") h.render({ value: 28, defaultValue: 28 });
      else if (stop === "unmount") h.unmount();
      else h.control(h.render()).props[stop](pointer(stop));
      assert.deepEqual(h.commits, [], stop);
      if (stop !== "unmount") {
        const tree = h.render();
        assert.equal(Number(h.shown(tree)), stop === "reset" ? 28 : 44, stop);
        h.control(tree).props.onPointerUp(pointer("pointerup"));
        assert.deepEqual(h.commits, [], "a stale release cannot save a cancelled draft");
        h.unmount();
      }
      assert.equal(h.listeners.get("blur").size, 0, "no listener survives unmount");
    }
  });

  test(`${component}: clicking without a change does not save`, () => {
    const h = numericHarness(component);
    h.start();
    h.control(h.render()).props.onPointerUp(pointer("pointerup"));
    assert.deepEqual(h.calls, []);
    if (component === "SettingsScrubField") assert.equal(h.context.document.activeElement, h.inputHost);
    h.unmount();
  });
}

test("font-weight scrubbing preserves the 100-unit snap and Shift/Alt modifiers", () => {
  const h = numericHarness("SettingsScrubField", { value: 400, min: 100, max: 900, step: 100, weight: true });
  h.start(); h.move(30);
  assert.equal(h.shown(h.render()), "500");
  h.move(45, { shiftKey: true });
  assert.equal(h.shown(h.render()), "700");
  h.move(90, { altKey: true });
  assert.equal(h.shown(h.render()), "700", "fine movement does not jump when modifiers change");
  h.control(h.render()).props.onPointerUp(pointer("pointerup"));
  assert.deepEqual(h.commits, [700]);
  h.unmount();
});

test("scrub manual entry, arrow stepping, comma decimals and focus baseline remain usable", () => {
  const h = numericHarness("SettingsScrubField", { value: 1, min: -5, max: 20, step: 0.5 });
  let input = find(h.render(), (node) => node.type === "input");
  input.props.onFocus({ target: { value: "1" } });
  input.props.onChange({ target: { value: "2,5" } });
  assert.deepEqual(h.commits, []);
  input.props.onBlur({ target: { value: "2,5" } });
  assert.deepEqual(h.commits, [2.5]);
  input = find(h.render(), (node) => node.type === "input");
  input.props.onKeyDown({ key: "ArrowUp", shiftKey: true, preventDefault() {}, currentTarget: h.inputHost });
  assert.deepEqual(h.commits, [2.5, 7.5]);
  assert.equal(h.inputHost.dataset.ivBefore, "7.5", "Escape must not undo a committed keyboard step");
  find(h.render(), (node) => node.type === "input").props.onBlur({ target: { value: "7.5" } });
  assert.deepEqual(h.commits, [2.5, 7.5], "blur cannot save the keyboard step twice");
  for (const text of ["", "nonsense"]) input.props.onBlur({ target: { value: text } });
  assert.deepEqual(h.commits, [2.5, 7.5]);
  h.unmount();
});

test("range keyboard changes, manual value field and presets still commit immediately", () => {
  const h = numericHarness("ConfigSliderRange", { min: 10, max: 240, step: 1, variant: "fps" });
  h.control(h.render()).props.onChange({ target: { value: "60" } });
  find(h.render(), (node) => node.type.name === "SettingsNumberField").props.onCommit(90);
  find(h.render(), (node) => node.type === "button" && node.props.children[0] === "120").props.onClick();
  assert.deepEqual(h.commits, [60, 90, 120]);
  h.unmount();
});

test("synced line-window preview renders every configured line, including 0 before and 10 after", () => {
  const h = harness(section("const SettingsLineWindow =", "// Sync Creator shortcuts:"), "SettingsLineWindow", {
    SettingsStepper: function SettingsStepper() {},
  });
  const items = [{ key: "lines-before", desc: "Before" }, { key: "lines-after", desc: "After" }];
  for (const [before, after] of [[0, 10], [10, 0], [7, 8], [0, 0], [0, 2]]) {
    h.context.CONFIG.visual = { "lines-before": String(before), "lines-after": after };
    const tree = h.render({ items, onChange() {} });
    const bars = elements(tree).filter((node) => node.props.className?.startsWith("settings-linewin-line"));
    assert.deepEqual(bars.map((node) => node.props.key), [
      ...Array.from({ length: before }, (_, index) => `before-${before - index}`), "active",
      ...Array.from({ length: after }, (_, index) => `after-${index + 1}`),
    ]);
    assert.ok(bars.every((node) => !node.props.className.includes("is-hidden")));
    assert.ok(bars.filter((node) => node.props.key !== "active").every((node) => node.props.style["--o"] >= 0.14));
  }
});

test("translation target selection saves and refreshes current lyrics without reloading the app", () => {
  const h = harness([
    compareCode,
    section("const saveSettingsTranslationTargetLanguage =", "const getSettingsMotionDurationMs ="),
    section("  const renderGeneralTab =", "  const renderPerformanceTab ="),
  ].join("\n"), "renderGeneralTab", {
    activeTab: "general",
    SettingsSection: function SettingsSection() {}, OptionList: function OptionList() {},
    ConfigSelection: function ConfigSelection() {}, OverlaySettings: function OverlaySettings() {},
    Spicetify: { Player: { data: { item: { uri: "spotify:track:current" } } } },
    I18n: { t: (key) => key, getAvailableLanguages: () => [{ code: "en", name: "English" }, { code: "ko", name: "한국어" }] },
    queueReloadIntoIvLyrics: () => assert.fail("target-language changes must not schedule a window reload"),
  });
  h.context.CONFIG.visual = { "translate:target-language": "auto", language: "en" };
  const options = find(h.render(), (node) => node.type.name === "OptionList").props.items;
  const target = options.find((item) => item.key === "translate:target-language");
  assert.deepEqual(Object.keys(target.options), ["auto", "en", "ko"]);
  for (const value of ["ko", "en", "auto"]) {
    h.calls.length = 0;
    target.onChange(target.key, value);
    assert.equal(h.context.CONFIG.visual[target.key], value);
    assert.equal(h.context.CONFIG.visual.language, "en", "UI language remains independent");
    assert.deepEqual(h.calls, [
      ["saveConfig", target.key, value],
      ["event", "ivLyrics", { type: "config", name: target.key, value }],
      ["reloadLyrics", false],
    ]);
  }
  h.calls.length = 0;
  target.onChange(target.key, "auto");
  assert.deepEqual(h.calls, [], "selecting the saved value does no work");
  h.context.Spicetify.Player.data = null;
  target.onChange(target.key, "ko");
  assert.equal(h.calls.length, 2, "no playing track still saves and broadcasts the setting");
});

test("section navigation hides only when the actual sections fit and returns on resize", () => {
  const observers = [];
  const h = harness(section("const isSettingsTocNeeded =", "const getSettingsPreviewKind ="), "SettingsToc", {
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    },
  });
  let bodyHeight = 480, focused = 0;
  const toc = {
    hidden: false, offsetHeight: 28, scrollWidth: 200, clientWidth: 400, scrollLeft: 0,
    classList: { toggle() {} }, addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    contains: (element) => element === "toc-button",
  };
  const sections = ["language", "overlay-enabled"].map((key) => ({ key, label: key }));
  const rendered = sections.map(() => ({
    closest: () => null, getClientRects: () => [1],
    getBoundingClientRect: () => ({ bottom: 100 + bodyHeight + (toc.hidden ? 0 : 40) - content.scrollTop }),
  }));
  const page = {};
  const content = {
    clientHeight: 500, scrollHeight: 800, scrollTop: 0,
    querySelectorAll: () => rendered, querySelector: () => page,
    getBoundingClientRect: () => ({ top: 100 }), focus: () => { focused++; },
  };
  const props = { sections, signal: { get: () => "language" }, contentRef: { current: content }, label: "General" };
  const render = () => h.render(props, (tree) => {
    tree.props.ref.current = toc;
    toc.hidden = tree.props.hidden;
  });
  render();
  let tree = render();
  assert.equal(tree.props.hidden, true, "navigation alone and trailing scroll padding do not create meaningful overflow");
  assert.equal(tree.props.style.display, "none", "author CSS cannot override native hidden styling");
  assert.ok(observers[0].targets.has(content) && observers[0].targets.has(page));
  bodyHeight = 650;
  observers[0].callback(); h.flushFrames();
  tree = render();
  assert.equal(tree.props.hidden, false);
  let selected;
  props.onSelect = (key) => { selected = key; };
  find(render(), (node) => node.type === "button" && node.props.key === "overlay-enabled").props.onClick();
  assert.equal(selected, "overlay-enabled", "visible navigation keeps native keyboard-activatable buttons");
  h.context.document.activeElement = "toc-button";
  content.scrollTop = 120;
  content.clientHeight = 700;
  h.fire("resize"); h.flushFrames();
  assert.equal(render().props.hidden, true);
  assert.equal(focused, 1, "hiding a focused strip returns focus to the keyboard-accessible content");
  h.fire("resize");
  h.unmount();
  assert.equal(h.frames.size, 0);
  assert.ok(observers.every((observer) => observer.targets.size === 0));
  assert.equal(h.listeners.get("resize").size, 0);
});
