import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const section = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing production section: ${from}`);
  return source.slice(start, end);
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// Exercise production presentation, mapping, memory and persistent-cache reads.
// All text is synthetic; an unexpected AI request fails instead of using a network.
function harness({ mode1 = "gemini_ko", mode2 = "none", target = "zh-CN" } = {}) {
  const lines = [{ text: "明日も一緒に歩こう", startTime: 1000, endTime: 3000 }];
  const item = { uri: "spotify:track:translation-identity", title: "Fixture", artist: "Fixture" };
  const config = { visual: {
    "translate:target-language": target,
    "translation-mode:japanese": mode1,
    "translation-mode-2:japanese": mode2,
  } };
  let locale = "zh-CN", style = "natural";
  const reads = [], presentations = [];
  const window = {
    CONFIG: config,
    I18n: { getCurrentLanguage: () => locale },
    AIAddonManager: { getTranslationStyle: () => style },
    ivLyricsTextComparison: {
      normalize: value => String(value || "").trim(),
      areEquivalent: (left, right) => left === right,
    },
    LyricsCache: {
      async getTranslation(id, lang, phonetic, provider, hash) {
        reads.push({ id, lang, phonetic, provider, hash });
        const value = phonetic ? `${lang}:reading` : `${lang}:${style}:meaning`;
        return phonetic ? { phonetic: [value] } : { translation: [value] };
      },
    },
    Translator: { callGemini() { assert.fail("Cached fixtures must not generate AI output"); } },
  };
  const context = vm.createContext({
    window, CONFIG: config, APP_NAME: "ivLyrics", console,
    Spicetify: { Player: { data: { item } } },
    localStorage: { getItem: () => null },
    StorageManager: { getPersisted() {} },
    Utils: { isSectionHeader: () => false, getTranslationCacheId: uri => uri.split(":").at(-1) },
    RateLimiter: { canMakeCall: () => true },
    SYNCED: 1, UNSYNCED: 2, isKaraokeRenderMode: value => value === 0,
    ivLyricsDebug() {}, I18n: { t: key => key },
    Toast: { error(message) { assert.fail(message); } },
  });
  vm.runInContext([
    section("const getCurrentTranslationTargetLanguage =", "window.ivLyricsPronunciationNotation ="),
    section("const getTranslationPartText =", "const hasInstrumentalMarker ="),
    section("const getLyricsTextCacheHash =", "const isLyricsRenderCacheCurrent ="),
    section("const getDisplayModeGenerationOptions =", "// window에 등록하여 Settings.js에서 접근 가능하도록 함"),
    section("const isTranslationNoteLine =", "// The floating toolbar names lyrics modes"),
    `class Container {
      ${section("  lyricsSource(", "  getTraditionalConversion(")}
    }
    globalThis.Container = Container;`,
  ].join("\n"), context);
  const app = new context.Container();
  Object.assign(app, {
    state: { ...item, synced: lines, currentLyrics: lines, provider: "fixture" },
    _lyricsPresentationSeq: 0, _dmResults: {}, _inflightGemini: new Map(),
    _sharedPresentationKeys: new Map(),
    isCurrentLyricsState: () => true,
    resolveLyricsForMode: state => state.synced,
    provideLanguageCode: () => "ja",
    requestCulturalAnnotations() {},
    applyCulturalAnnotations: lyrics => lyrics,
    publishLyricsPresentation(lyrics, detail) { presentations.push({ lyrics, detail }); },
    setState(patch) { this.state = { ...this.state, ...patch }; },
    startTranslationLoading() {}, startPhoneticLoading() {},
    clearTranslationLoading() {}, clearPhoneticLoading() {},
  });
  // Use the same target resolver as the page (including auto/interface locale).
  app.getTranslationTargetLanguage = vm.runInContext("getCurrentTranslationTargetLanguage", context);
  return {
    app, reads, presentations, lines,
    setTarget: value => { config.visual["translate:target-language"] = value; },
    setLocale: value => { locale = value; },
    setStyle: value => { style = value; },
    setNotation: value => { config.visual["translate:pronunciation-notation"] = value; },
    async present() { app.lyricsSource(app.state, 1); await flush(); return app.state.currentLyrics[0]; },
  };
}

for (const [mode1, mode2] of [["gemini_ko", "none"], ["none", "gemini_ko"], ["gemini_ko", "gemini_romaji"]]) {
  test(`${mode1}/${mode2}: a completed Chinese presentation cannot override the Korean cache`, async () => {
    const h = harness({ mode1, mode2 });
    assert.equal((await h.present()).text2, "zh-CN:natural:meaning");
    h.setTarget("ko");
    const result = await h.present();
    assert.equal(result.text2, "ko:natural:meaning");
    if (mode2 === "gemini_romaji") assert.equal(result.phoneticText, "ko:reading");
    const reads = h.reads.length;
    assert.equal((await h.present()).text2, "ko:natural:meaning");
    assert.equal(h.reads.length, reads, "unchanged presentation reuses its completed results");
    assert.equal(h.presentations.at(-1).detail.translationSourceLyrics, h.lines);
  });
}

test("auto target follows the interface locale even when both display modes stay the same", async () => {
  const h = harness({ target: "auto", mode2: "gemini_romaji" });
  await h.present();
  h.setLocale("ko");
  const result = await h.present();
  assert.equal(result.text2, "ko:natural:meaning");
  assert.equal(result.phoneticText, "ko:reading");
});

test("translation style invalidates only the completed translation slot", async () => {
  const h = harness({ target: "ko", mode2: "gemini_romaji" });
  await h.present();
  const phoneticReads = h.reads.filter(read => read.phonetic).length;
  h.setStyle("literal");
  assert.equal((await h.present()).text2, "ko:literal:meaning");
  assert.equal(h.reads.filter(read => read.phonetic).length, phoneticReads);
});

test("pronunciation notation preserves the completed translation slot", async () => {
  const h = harness({ target: "ko", mode2: "gemini_romaji" });
  await h.present();
  const translationReads = h.reads.filter(read => !read.phonetic).length;
  h.setNotation("ipa");
  assert.equal((await h.present()).text2, "ko:natural:meaning");
  assert.equal(h.reads.filter(read => !read.phonetic).length, translationReads);
  assert.ok(h.reads.filter(read => read.phonetic).at(-1).hash.includes("notation=ipa"));
});

test("provider translation fields cannot replace the selected cached AI translation", async () => {
  const h = harness({ target: "ko" });
  Object.assign(h.lines[0], { translation: "供应商翻译", translationText: "供应商翻译", text2: "供应商翻译" });
  const result = await h.present();
  assert.equal(result.text2, "ko:natural:meaning");
  assert.equal(result.translationText, "ko:natural:meaning");
  assert.equal(result.originalText, h.lines[0].text);
  assert.equal(h.lines[0].translation, "供应商翻译", "provider input is not mutated");
});
