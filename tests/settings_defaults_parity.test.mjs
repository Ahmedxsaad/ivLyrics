import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// The settings window marks changed settings, offers a per-row reset and
// draws a default marker on sliders from a table of defaults in Settings.js
// (SETTINGS_DEFAULT_VALUES). The real defaults live in the CONFIG literal of
// index.js; this test keeps the two in sync.
const settingsSource = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");

const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
};

const loadSettingsTable = () => {
  const context = vm.createContext({});
  vm.runInContext(`${section(settingsSource, "const SETTINGS_DEFAULT_VALUES =", "const getCurrentSettingValue =")}
    globalThis.table = {
      SETTINGS_DEFAULT_VALUES, SETTINGS_FALLBACK_DEFAULT_VALUES, hasSettingDefault, getSettingDefaultValue,
      normalizeSettingComparable, settingValuesEqual,
    };`, context);
  return context.table;
};

// CONFIG.visual as index.js builds it on a fresh install (empty storage).
// Helpers the literal calls are copied in as they are discovered.
const loadIndexDefaults = () => {
  const start = indexSource.indexOf("const CONFIG = {");
  const end = indexSource.indexOf("window.CONFIG = CONFIG;", start);
  assert.ok(start >= 0 && end > start, "CONFIG literal found in index.js");
  const body = indexSource.slice(start, end);
  const extract = (name) => {
    const match = new RegExp(`^(?:const ${name} =[ \\n]|function ${name}\\s*\\()`, "m").exec(indexSource);
    assert.ok(match, `helper ${name} found in index.js`);
    const rest = indexSource.slice(match.index + 1);
    const next = rest.search(/\n(?=(?:const|let|var|function|class|window\.|\(function)\b)/);
    return indexSource.slice(match.index, match.index + 1 + next);
  };
  const helpers = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const context = vm.createContext({
      APP_NAME: "ivLyrics",
      StorageManager: {
        get: (_key, fallback = true) => fallback,
        getItem: () => null, setItem() {}, removeItem() {},
        getPersisted: () => null, setPersisted() {},
      },
      window: {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      navigator: { language: "en-US", languages: ["en-US"] },
      console,
    });
    try {
      vm.runInContext(`${helpers.map(extract).join("\n")}\n${body}\nglobalThis.visual = CONFIG.visual;`, context);
      return context.visual;
    } catch (error) {
      const missing = /^(\w+) is not defined/.exec(error.message)?.[1];
      if (!missing || helpers.includes(missing)) throw error;
      helpers.unshift(missing);
    }
  }
  throw new Error("could not evaluate the CONFIG literal of index.js");
};

// Settings without a fixed default (environment, per-song or account data,
// colours the theme decides) and the background presets, which the window
// treats as one choice with its own default.
const NOT_TRACKED = [
  /^language$/, /^delay$/, /^translate$/, /^synced-compact$/, /^global-sync-offset$/,
  /^(?:background|active|inactive|highlight)-color$/, /^font-size$/, /^font-family$/,
  /^(?:colorful|gradient-background|blur-gradient-background|solid-background|video-background)$/,
  /^translation-mode/, /^gemini-api-key/, /^community-video-/,
  /^translate:(?:translated-lyrics-source|display-mode|pronunciation-notation|detect-language-override)$/,
];

test("every default in the settings table matches index.js", () => {
  const table = loadSettingsTable();
  const visual = loadIndexDefaults();
  const mismatched = Object.entries(table.SETTINGS_DEFAULT_VALUES)
    .filter(([key, value]) => !(key in visual) || !table.settingValuesEqual(value, visual[key]))
    .map(([key, value]) => `${key}: table ${JSON.stringify(value)}, index.js ${JSON.stringify(visual[key])}`);
  assert.deepEqual(mismatched, []);
});

test("every CONFIG.visual setting of index.js has a default in the table or is deliberately not tracked", () => {
  const table = loadSettingsTable();
  const visual = loadIndexDefaults();
  const missing = Object.keys(visual).filter((key) =>
    !(key in table.SETTINGS_DEFAULT_VALUES) && !NOT_TRACKED.some((pattern) => pattern.test(key)));
  assert.deepEqual(missing, []);
});

test("fallback defaults only cover settings index.js does not seed", () => {
  const table = loadSettingsTable();
  const visual = loadIndexDefaults();
  const seeded = Object.keys(table.SETTINGS_FALLBACK_DEFAULT_VALUES).filter((key) => key in visual);
  assert.deepEqual(seeded, []);
  for (const [key, value] of Object.entries(table.SETTINGS_FALLBACK_DEFAULT_VALUES)) {
    assert.equal(table.hasSettingDefault(key), true);
    assert.equal(table.getSettingDefaultValue(key), value);
  }
  assert.equal(table.hasSettingDefault("not-a-setting"), false);
  assert.equal(table.hasSettingDefault(undefined), false);
});

test("stored values are compared the way they are shown", () => {
  const { settingValuesEqual: equal } = loadSettingsTable();
  assert.equal(equal("16", 16), true);
  assert.equal(equal("0.50", 0.5), true);
  assert.equal(equal("-2", -2), true);
  assert.equal(equal("true", true), true);
  assert.equal(equal("false", false), true);
  assert.equal(equal("#ABCDEF", "#abcdef"), true);
  assert.equal(equal(" Pretendard Variable ", "Pretendard Variable"), true);
  assert.equal(equal(null, ""), true);
  assert.equal(equal(undefined, ""), true);
  assert.equal(equal("1", "2"), false);
  assert.equal(equal("", 0), false);
  assert.equal(equal(false, 0), false);
  assert.equal(equal("Roboto", "roboto"), false);
});
