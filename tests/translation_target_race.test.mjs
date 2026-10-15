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
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const modes = ["gemini_ko", "gemini_romaji"];

// Run production keys, cache, translation writers and the reload callback.
// Only provider requests and the fetchLyrics transport boundary are deferred.
function harness(mode = "gemini_ko") {
  const calls = [], reloads = [], progress = [], completions = [], writes = [];
  const lines = [{ text: "こんにちは", startTime: 1000 }];
  const item = { uri: "spotify:track:race", title: "Song", artist: "Artist" };
  const config = { visual: { "translate:target-language": "en", "translation-mode:japanese": mode } };
  let style = "natural", token = 0;
  const window = {
    CONFIG: config,
    I18n: { getCurrentLanguage: () => "en" },
    AIAddonManager: { getTranslationStyle: () => style },
    ivLyricsTextComparison: { areEquivalent: (left, right) => left === right },
    LyricsCache: {
      getTranslation: async () => null,
      setTranslation: async (...args) => writes.push(args),
    },
    Translator: {
      clearInflightRequests() {},
      callGemini(params) {
        const request = { ...deferred(), params, language: context.targetLanguage(), style };
        calls.push(request);
        return request.promise;
      },
    },
  };
  const context = vm.createContext({
    window, CONFIG: config, APP_NAME: "ivLyrics",
    Spicetify: { Player: { data: { item } } },
    localStorage: { getItem: () => null },
    StorageManager: { getPersisted() {} },
    Utils: {
      isSectionHeader: () => false,
      setDetectedLanguage() {},
      extractTrackId: uri => uri?.split(":").at(-1),
      getTranslationCacheId: uri => uri?.split(":").at(-1),
    },
    RateLimiter: { canMakeCall: () => true },
    LyricsService: { detectLanguage: () => "ja" },
    SYNCED: 1, UNSYNCED: 2, isKaraokeRenderMode: value => value === 0,
    Toast: { show() {}, success() {}, error(message) { assert.fail(message); } },
    ivLyricsDebug() {}, I18n: { t: key => key },
  });
  vm.runInContext([
    section("const getCurrentTranslationTargetLanguage =", "window.ivLyricsPronunciationNotation ="),
    section("const getTranslationPartText =", "const hasInstrumentalMarker ="),
    section("const getLyricsTextCacheHash =", "const isLyricsRenderCacheCurrent ="),
    section("const getDisplayModeGenerationOptions =", "// window에 등록하여 Settings.js에서 접근 가능하도록 함"),
    `globalThis.prefetcher = {
      _prefetchCache: new Map(), _inflightRequests: new Map(),
      ${section("  async _prefetchTranslations(", "  async _prefetchWordSupplements(")}
    };`,
    `class Container {
      ${section("  isCurrentLyricsUri(", "  clearPendingLyricsUpdates(")}
      ${section("  getGeminiTranslation(", "  getTraditionalConversion(")}
      ${section("  async regenerateTranslation(", "  async selectLyricsProviderForCurrentTrack(")}
    }
    function attachReload() {
      let reloadLyrics;
      ${section("    reloadLyrics = async (clearCache = true) => {", "    // Expose reloadLyrics")}
      return reloadLyrics;
    }
    globalThis.Container = Container;
    globalThis.cache = CacheManager;
    globalThis.cacheKey = getDisplayModeCacheKey;
    globalThis.shapeSignature = getLyricsProcessingShapeSignature;
    globalThis.targetLanguage = getCurrentTranslationTargetLanguage;
    const CACHE = {};`,
  ].join("\n"), context);
  const app = new context.Container();
  context.app = app;
  Object.assign(app, {
    state: { ...item, synced: lines, currentLyrics: lines, provider: "lrclib", lyricsRequestSeq: 1, explicitMode: -1 },
    currentTrackUri: item.uri, _lyricsFetchSeq: 1, _activeLyricsFetchSeq: 1,
    _inflightGemini: new Map(), _dmResults: {},
    getTranslationTargetLanguage: context.targetLanguage,
    provideLanguageCode: () => "ja",
    getCurrentMode: () => 1,
    getRegenerationTargets: () => ({
      provider: "gemini", mode1: mode, mode2: "none", isGeminiMode: true,
      needPhonetic: mode === "gemini_romaji", needTranslation: mode !== "gemini_romaji",
    }),
    applyStreamingTranslation: value => progress.push(value),
    invalidateSharedLyricsPresentation() {}, lyricsSource() {},
    startTranslationLoading: () => ++token, startPhoneticLoading: () => ++token,
    clearTranslationLoading: (...args) => completions.push(args),
    clearPhoneticLoading: (...args) => completions.push(args),
    infoFromTrack: track => track,
    getLoadingLyricsState: (info, seq) => ({ ...app.state, uri: info.uri, lyricsRequestSeq: seq }),
    setState(patch) { this.state = { ...this.state, ...patch }; },
    clearPendingLyricsUpdates() {}, updateVisualOnConfigChange() {}, forceUpdate() {},
    fetchLyrics(track, explicitMode, refresh) {
      const promise = this.getGeminiTranslation(this.state, lines, mode, (...args) => progress.push(args));
      reloads.push({ track, explicitMode, refresh, promise });
      return promise;
    },
  });
  app.reloadLyrics = vm.runInContext("attachReload.call(app)", context);
  return {
    app, calls, reloads, progress, completions, writes, context, cache: context.cache, lines, window,
    prefetcher: context.prefetcher,
    prefetch: () => context.prefetcher._prefetchTranslations(item, app.state),
    key: (keyMode = mode) => context.cacheKey(app.state, keyMode),
    request: () => app.getGeminiTranslation(app.state, lines, mode, (...args) => progress.push(args)),
    setTarget: value => { config.visual["translate:target-language"] = value; },
    setStyle: value => { style = value; },
    setNotation: value => { config.visual["translate:pronunciation-notation"] = value; },
    resolve(request, text) {
      request.resolve(request.params.wantSmartPhonetic ? { phonetic: [text] } : { translation: [text] });
    },
  };
}

for (const mode of modes) {
  for (const order of ["old-first", "new-first"]) {
    test(`${mode}: target switch and reload preserve Korean cache (${order})`, async () => {
      const h = harness(mode);
      const oldKey = h.key();
      const oldPromise = h.request();
      await flush();
      h.setTarget("ko");
      const newKey = h.key();
      assert.notEqual(newKey, oldKey, "target language is part of memory/in-flight identity");
      await h.app.reloadLyrics(false);
      const currentPromise = h.reloads.at(-1).promise;
      await flush();
      assert.deepEqual(h.calls.map(call => call.language), ["en", "ko"]);
      const currentInflight = h.app._inflightGemini.get(newKey);
      h.calls[0].params.onLine(0, "obsolete English stream");
      h.calls[0].params.onStreamReset();
      assert.equal(h.progress.length, 0);
      const settleOld = async () => { h.resolve(h.calls[0], "Hello"); await oldPromise; };
      const settleNew = async () => { h.resolve(h.calls[1], "안녕하세요"); await currentPromise; };
      if (order === "old-first") {
        await settleOld();
        assert.strictEqual(h.app._inflightGemini.get(newKey), currentInflight);
        assert.equal(h.cache.get(newKey), null);
        await settleNew();
      } else {
        await settleNew();
        await settleOld();
      }
      assert.equal(h.cache.get(newKey)[0].text, "안녕하세요");
      assert.equal(h.cache.get(oldKey), null, "a cancelled request cannot repopulate memory");
      assert.equal((await h.request())[0].text, "안녕하세요");
      assert.equal(h.calls.length, 2, "current target reuses its correct cached result");
      await h.app.reloadLyrics(false);
      await flush();
      assert.equal(h.calls[2].language, "ko", "a later reload still requests the current target");
      assert.equal(h.reloads.at(-1).refresh, true);
      h.resolve(h.calls[2], "새 결과");
      await h.reloads.at(-1).promise;
      assert.equal((await h.request())[0].text, "새 결과");
    });

    test(`${mode}: replaced same-key requests own cache writes and cleanup (${order})`, async () => {
      const h = harness(mode);
      const oldPromise = h.request();
      await flush();
      await h.app.reloadLyrics(false);
      await flush();
      const currentPromise = h.reloads.at(-1).promise;
      const currentInflight = h.app._inflightGemini.get(h.key());
      const settleOld = async () => { h.resolve(h.calls[0], "Obsolete"); await oldPromise; };
      const settleNew = async () => { h.resolve(h.calls[1], "Current"); await currentPromise; };
      if (order === "old-first") {
        await settleOld();
        assert.strictEqual(h.app._inflightGemini.get(h.key()), currentInflight);
        assert.equal(h.cache.get(h.key()), null);
        const joined = h.request();
        await flush();
        assert.equal(h.calls.length, 2, "old cleanup cannot break current request deduplication");
        await settleNew();
        assert.equal((await joined)[0].text, "Current");
      } else {
        await settleNew();
        await settleOld();
      }
      assert.equal(h.cache.get(h.key())[0].text, "Current");
      assert.equal((await h.request())[0].text, "Current");
      assert.equal(h.app._inflightGemini.size, 0);
    });

    test(`${mode}: late prefetch cannot use a new target's cache identity (${order})`, async () => {
      const h = harness(mode);
      const oldKey = h.key();
      const oldPromise = h.prefetch();
      await flush();
      h.setTarget("ko");
      const newPromise = h.prefetch();
      await flush();
      assert.deepEqual(h.calls.map(call => call.language), ["en", "ko"]);
      const settleOld = async () => { h.resolve(h.calls[0], "Hello"); await oldPromise; };
      const settleNew = async () => { h.resolve(h.calls[1], "안녕하세요"); await newPromise; };
      if (order === "old-first") {
        await settleOld();
        assert.equal(h.prefetcher._inflightRequests.size, 1);
        assert.equal(h.cache.get(h.key()), null);
        await settleNew();
      } else {
        await settleNew();
        await settleOld();
      }
      assert.equal(h.cache.get(oldKey), null);
      assert.equal((await h.request())[0].text, "안녕하세요");
      assert.equal(h.calls.length, 2, "prefetch and foreground use the same generation identity");
      assert.equal(h.prefetcher._prefetchCache.size, 1);
      assert.equal(h.prefetcher._inflightRequests.size, 0);
    });

    test(`${mode}: regeneration cannot stream or save into a newer target (${order})`, async () => {
      const h = harness(mode);
      const oldPromise = h.app.regenerateTranslation();
      await flush();
      h.setTarget("ko");
      await h.app.reloadLyrics(false);
      await flush();
      h.calls[0].params.onLine(0, "obsolete regeneration stream");
      h.calls[0].params.onStreamReset();
      assert.equal(h.progress.length, 0);
      const currentPromise = h.reloads.at(-1).promise;
      const settleOld = async () => { h.resolve(h.calls[0], "Hello"); await oldPromise; };
      const settleNew = async () => { h.resolve(h.calls[1], "안녕하세요"); await currentPromise; };
      if (order === "old-first") { await settleOld(); await settleNew(); }
      else { await settleNew(); await settleOld(); }
      assert.equal(h.writes.length, 0, "obsolete regeneration cannot persist under the current target");
      assert.equal((await h.request())[0].text, "안녕하세요");
      const regenerateCurrent = h.app.regenerateTranslation();
      await flush();
      assert.equal(h.calls[2].language, "ko");
      h.resolve(h.calls[2], "새 결과");
      await regenerateCurrent;
      assert.equal(h.writes[0][1], "ko");
      assert.equal(h.cache.get(h.key())[0].text, "새 결과");
    });
  }
}

test("memory identity matches persistent translation style and pronunciation options", () => {
  const h = harness();
  const translation = h.key("gemini_ko"), phonetic = h.key("gemini_romaji");
  h.setStyle("literal");
  assert.notEqual(h.key("gemini_ko"), translation);
  assert.equal(h.key("gemini_romaji"), phonetic, "translation style does not affect pronunciation");
  const literal = h.key("gemini_ko");
  h.setNotation("ipa");
  assert.notEqual(h.key("gemini_romaji"), phonetic);
  assert.equal(h.key("gemini_ko"), literal, "pronunciation notation does not affect translation");
  assert.match(h.key("gemini_romaji"), /phonetic-prompt=\d+:notation=ipa/);
});

for (const [mode, change] of [["gemini_ko", h => h.setStyle("literal")], ["gemini_romaji", h => h.setNotation("ipa")]]) {
  test(`${mode}: changing generation options discards a pending result`, async () => {
    const h = harness(mode);
    const pending = h.request();
    await flush();
    change(h);
    h.calls[0].params.onLine(0, "obsolete stream");
    h.resolve(h.calls[0], "Obsolete");
    assert.equal(await pending, null);
    assert.equal(h.progress.length, 0);
    assert.equal(h.cache._cache.size, 0);
    const current = h.request();
    await flush();
    h.resolve(h.calls[1], "Current");
    assert.equal((await current)[0].text, "Current");
    assert.equal(h.cache.get(h.key())[0].text, "Current");
  });
}

test("a target switch during persistent-cache lookup cannot launch a stale request", async () => {
  const h = harness();
  const read = deferred();
  h.window.LyricsCache.getTranslation = () => read.promise;
  const pending = h.request();
  h.setTarget("ko");
  read.resolve(null);
  assert.equal(await pending, null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.cache._cache.size, 0);
});

test("obsolete requests cannot recreate in-flight state after teardown", async () => {
  const h = harness();
  const pending = h.request();
  await flush();
  h.app._inflightGemini = null;
  h.resolve(h.calls[0], "Obsolete");
  await pending;
  assert.equal(h.app._inflightGemini, null);
  assert.equal(h.cache.get(h.key()), null);
});

test("prefetch failure before its first await resolves cleanly and allows retry", async () => {
  const h = harness();
  h.context.ivLyricsDebug = message => {
    if (message.includes("Fetching translation")) throw new Error("synchronous setup failure");
  };
  assert.equal(await h.prefetch(), null);
  assert.equal(h.prefetcher._inflightRequests.size, 0);
  h.context.ivLyricsDebug = () => {};
  const retry = h.prefetch();
  await flush();
  assert.equal(h.calls.length, 1);
  h.resolve(h.calls[0], "Current");
  await retry;
  assert.equal(h.cache.get(h.key())[0].text, "Current");
  assert.equal(h.prefetcher._inflightRequests.size, 0);
});

test("prefetch early failure cannot clear a same-key replacement", async () => {
  const h = harness();
  let replacement;
  h.context.ivLyricsDebug = message => {
    if (!message.includes("Fetching translation")) return;
    h.context.ivLyricsDebug = () => {};
    const key = h.prefetcher._inflightRequests.keys().next().value;
    assert.ok(key, "ownership must be registered before synchronous callbacks run");
    h.prefetcher._inflightRequests.delete(key);
    replacement = h.prefetch();
    throw new Error("obsolete synchronous setup failure");
  };
  assert.equal(await h.prefetch(), null);
  await flush();
  assert.equal(h.prefetcher._inflightRequests.size, 1);
  assert.equal(h.calls.length, 1);
  h.resolve(h.calls[0], "Replacement");
  await replacement;
  assert.equal(h.cache.get(h.key())[0].text, "Replacement");
  assert.equal(h.prefetcher._inflightRequests.size, 0);
});

for (const kind of ["foreground", "prefetch"]) {
  test(`${kind}: synchronous provider failure preserves a reentrant replacement`, async () => {
    const h = harness();
    const requests = kind === "foreground" ? h.app._inflightGemini : h.prefetcher._inflightRequests;
    const start = kind === "foreground" ? h.request : h.prefetch;
    const provider = h.window.Translator.callGemini;
    let replacement;
    h.window.Translator.callGemini = () => {
      h.window.Translator.callGemini = provider;
      const key = requests.keys().next().value;
      requests.delete(key);
      replacement = start();
      throw new Error("synchronous provider failure");
    };
    const obsolete = start();
    if (kind === "foreground") await assert.rejects(obsolete, /^Error: synchronous provider failure$/);
    else assert.equal(await obsolete, null);
    await flush();
    assert.equal(requests.size, 1);
    assert.equal(h.calls.length, 1);
    h.resolve(h.calls[0], "Replacement");
    await replacement;
    assert.equal(h.cache.get(h.key())[0].text, "Replacement");
    assert.equal(requests.size, 0);
  });
}

test("empty or malformed prefetch sources leave active requests intact", async () => {
  const h = harness();
  const active = Promise.resolve("active");
  h.prefetcher._inflightRequests.set("protected", active);
  for (const lyrics of [null, undefined, {}, { synced: [] }, { synced: {} }, { synced: "bad" },
    { synced: [null, {}, { text: "" }] }]) {
    assert.equal(await h.prefetcher._prefetchTranslations({ uri: h.app.state.uri }, lyrics), undefined);
    assert.strictEqual(h.prefetcher._inflightRequests.get("protected"), active);
    assert.equal(h.prefetcher._inflightRequests.size, 1);
  }
  assert.equal(h.calls.length, 0);
});

test("foreground malformed input rejects without changing in-flight state", async () => {
  const h = harness();
  const active = Promise.resolve("active");
  h.app._inflightGemini.set(h.key(), active);
  for (const lyrics of [null, undefined, {}, [], "bad"]) {
    await assert.rejects(h.app.getGeminiTranslation(h.app.state, lyrics, "gemini_ko"), /Gemini API key missing/);
    assert.strictEqual(h.app._inflightGemini.get(h.key()), active);
    assert.equal(h.app._inflightGemini.size, 1);
  }
  assert.equal(h.calls.length, 0);
});

test("blank lyric rows handle synchronous provider validation errors", async () => {
  const h = harness();
  h.lines.splice(0, h.lines.length, null, {}, { text: "" });
  h.window.Translator.callGemini = () => { throw new Error("No text provided for translation"); };
  await assert.rejects(h.request(), /^Error: No text provided for translation$/);
  assert.equal(h.app._inflightGemini.size, 0);
  assert.equal(h.cache._cache.size, 0);
});

test("generation options add no text scans beyond the existing lyric shape signature", () => {
  const h = harness();
  let reads = 0;
  const lines = [{ get text() { reads++; return "こんにちは"; } }];
  h.context.shapeSignature(lines);
  const shapeReads = reads;
  assert.ok(shapeReads > 0);
  for (const mode of modes) {
    reads = 0;
    h.context.cacheKey({ ...h.app.state, currentLyrics: lines }, mode);
    assert.equal(reads, shapeReads, "only the existing shape calculation reads source text");
  }
});

test("stream ownership checks do not rescan the cached lyric source", async () => {
  const h = harness();
  let reads = 0;
  h.app.state.currentLyrics = [{ get text() { reads++; return "こんにちは"; } }];
  const pending = h.request();
  await flush();
  const initialReads = reads;
  h.calls[0].params.onLine(0, "Current");
  h.calls[0].params.onStreamReset();
  h.resolve(h.calls[0], "Current");
  await pending;
  assert.equal(reads, initialReads, "stream and completion guards only compare generation options");
});
