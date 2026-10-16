import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const options = readFileSync(new URL('../OptionsMenu.js', import.meta.url), 'utf8');
const section = (text, start, end) => {
  const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return text.slice(from, to);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function container() {
  const calls = [], snapshots = [], errors = [], cacheWrites = [];
  const cacheBarrier = { current: null };
  const context = vm.createContext({
    window: { Translator: {
      clearInflightRequests() {},
      callGemini(params) { const call = { params, ...deferred() }; calls.push(call); return call.promise; },
    } },
    Utils: { getTranslationCacheId: uri => uri },
    Toast: { show() {}, success() {}, error: message => errors.push(message) },
    I18n: { t: key => key }, ivLyricsDebug() {}, console,
    SYNCED: 1, UNSYNCED: 2, isKaraokeRenderMode: () => false,
    getNonSectionLyricsText: lines => lines.map(line => line.text).join('\n'),
    getDisplayModeCacheKey: (_state, mode) => mode,
    getDisplayModeGenerationOptions: () => 'stable-options',
    getSyncDataRendererCacheVersion: () => 1,
    getLyricsProcessingShapeSignature: () => 'fixture-shape',
    getCurrentLyricsPronunciationNotation: () => 'latin',
    normalizeTranslationOutputLines: lines => lines,
    mapTranslationLinesToLyrics: (_lyrics, lines) => lines.map(text => ({ text })),
    setCachedTranslationForText: async args => {
      cacheWrites.push(args);
      if (cacheBarrier.current) await cacheBarrier.current.promise;
    },
    CacheManager: { set() {} },
  });
  vm.runInContext(`class Container {
    ${section(source, '  async runRegenerateTranslationChoice(', '  async regenerateCulturalAnnotations(')}
    ${section(source, '  async regenerateTranslation(', '  async selectLyricsProviderForCurrentTrack(')}
  }; globalThis.Container = Container;`, context);
  const app = new context.Container();
  Object.assign(app, {
    state: { uri: 'track-a', provider: 'lrclib', currentLyrics: [{ text: 'A' }] },
    currentTrackUri: 'track-a', _isComponentMounted: true, _dmResults: {},
    getRegenerationTargets: () => ({ provider: 'gemini', mode1: 'gemini_romaji', mode2: 'gemini_ko',
      needPhonetic: true, needTranslation: true, isGeminiMode: true }),
    getCurrentMode: () => 1, getTranslationTargetLanguage: () => 'en', provideLanguageCode: () => 'ja',
    isCurrentLyricsUri(uri) { return this.currentTrackUri === uri; },
    isCurrentLyricsState(state) { return this.currentTrackUri === state.uri; },
    applyStreamingTranslation: data => snapshots.push(plain(data)),
    invalidateSharedLyricsPresentation() {}, lyricsSource() {}, forceUpdate() {},
    startPhoneticLoading() { return 1; }, clearPhoneticLoading() {},
    startTranslationLoading() { return 2; }, clearTranslationLoading() {},
  });
  return { app, calls, snapshots, errors, cacheWrites, cacheBarrier,
    resolve(call, text) { call.resolve(call.params.wantSmartPhonetic ? { phonetic: [text] } : { translation: [text] }); },
  };
}

test('different tasks start together while duplicates and overlapping combined requests are blocked', async () => {
  const h = container(), culture = deferred(), words = deferred();
  let cultureCalls = 0, wordCalls = 0;
  h.app.regenerateCulturalAnnotations = () => { cultureCalls++; return culture.promise; };
  h.app.regenerateWordSupplements = () => { wordCalls++; return words.promise; };
  const phonetic = h.app.runRegenerateTranslationChoice('phonetic');
  const translation = h.app.runRegenerateTranslationChoice('translation');
  const cultural = h.app.runRegenerateTranslationChoice('cultural-annotations');
  const word = h.app.runRegenerateTranslationChoice('word-supplements');
  assert.equal(h.calls.length, 2, 'both provider requests start without waiting');
  assert.equal(cultureCalls, 1); assert.equal(wordCalls, 1);
  await h.app.runRegenerateTranslationChoice('all');
  await h.app.runRegenerateTranslationChoice('phonetic');
  await h.app.runRegenerateTranslationChoice('word-supplements');
  assert.equal(h.calls.length, 2); assert.equal(wordCalls, 1);
  h.resolve(h.calls[0], 'pronunciation'); h.resolve(h.calls[1], 'translation');
  culture.resolve(); words.resolve();
  await Promise.all([phonetic, translation, cultural, word]);
  assert.equal(h.app._regenerationRequests.size, 0);
});

test('interleaved streams and resets preserve the other task results', async () => {
  const h = container();
  const phonetic = h.app.runRegenerateTranslationChoice('phonetic');
  const translation = h.app.runRegenerateTranslationChoice('translation');
  h.calls[0].params.onLine(0, 'pronunciation stream');
  h.calls[1].params.onLine(0, 'translation stream');
  assert.deepEqual(h.snapshots.at(-1).lyricsMode1, [{ text: 'pronunciation stream' }]);
  assert.deepEqual(h.snapshots.at(-1).lyricsMode2, [{ text: 'translation stream' }]);
  h.calls[0].params.onStreamReset();
  assert.deepEqual(h.snapshots.at(-1).lyricsMode2, [{ text: 'translation stream' }]);
  h.resolve(h.calls[0], 'pronunciation final'); await phonetic;
  h.calls[1].params.onLine(0, 'translation next');
  assert.deepEqual(h.snapshots.at(-1).lyricsMode1, [{ text: 'pronunciation final' }]);
  h.resolve(h.calls[1], 'translation final'); await translation;
  assert.deepEqual(plain(h.app._dmResults['track-a'].mode1), [{ text: 'pronunciation final' }]);
  assert.deepEqual(plain(h.app._dmResults['track-a'].mode2), [{ text: 'translation final' }]);
});

test('a cache-write await cannot restore an obsolete snapshot of the other field', async () => {
  const h = container(), barrier = deferred();
  const phonetic = h.app.runRegenerateTranslationChoice('phonetic');
  const translation = h.app.runRegenerateTranslationChoice('translation');
  h.cacheBarrier.current = barrier;
  h.resolve(h.calls[0], 'pronunciation final'); await flush();
  assert.equal(h.cacheWrites.length, 1);
  h.calls[1].params.onLine(0, 'latest translation');
  barrier.resolve(); await phonetic;
  assert.deepEqual(plain(h.app._dmResults['track-a'].mode2), [{ text: 'latest translation' }]);
  h.resolve(h.calls[1], 'translation final'); await translation;
  assert.deepEqual(plain(h.app._dmResults['track-a'].mode1), [{ text: 'pronunciation final' }]);
});

test('a failed task unlocks only itself and cannot discard another task', async () => {
  const h = container();
  const phonetic = h.app.runRegenerateTranslationChoice('phonetic');
  const translation = h.app.runRegenerateTranslationChoice('translation');
  h.calls[0].reject(new Error('fixture failure')); await phonetic;
  assert.equal(h.errors.length, 1);
  assert.equal(h.app._regenerationRequests.size, 1);
  const retry = h.app.runRegenerateTranslationChoice('phonetic');
  assert.equal(h.calls.length, 3);
  h.resolve(h.calls[1], 'translation final'); h.resolve(h.calls[2], 'retried pronunciation');
  await Promise.all([translation, retry]);
  assert.deepEqual(plain(h.app._dmResults['track-a'].mode2), [{ text: 'translation final' }]);
});

test('track changes ignore late streams and completions without unlocking a newer track request', async () => {
  const h = container();
  const old = h.app.runRegenerateTranslationChoice('translation');
  h.app.state = { ...h.app.state, uri: 'track-b' }; h.app.currentTrackUri = 'track-b';
  const next = h.app.runRegenerateTranslationChoice('translation');
  h.calls[0].params.onLine(0, 'obsolete'); h.resolve(h.calls[0], 'obsolete'); await old;
  assert.equal(h.snapshots.length, 0); assert.equal(h.cacheWrites.length, 0);
  assert.equal(h.app._regenerationRequests.size, 1);
  h.resolve(h.calls[1], 'current'); await next;
  assert.deepEqual(plain(h.app._dmResults['track-b'].mode2), [{ text: 'current' }]);
});

function buttons() {
  const hooks = []; let cursor;
  const react = {
    memo: value => value, createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  };
  const context = vm.createContext({ react,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useRef(value) { const i = cursor++; return hooks[i] ||= { current: value }; }, useEffect() {},
    I18n: { t: key => key }, ToolbarPanelRow: 'row', ToolbarButton: 'button', ToolbarGlyph: 'glyph',
    joinToolbarClasses: (...items) => items.filter(Boolean).join(' '), console: { warn() {} },
  });
  vm.runInContext(section(options, 'const getToolbarRegenerationKinds =', '// 현재 곡 > 개별 배경:') + '\nglobalThis.Component = RegenerateTranslationButton;', context);
  const requests = new Map(), calls = [];
  const props = { isEnabled: true, busyTargets: [],
    choices: ['phonetic', 'translation', 'all', 'cultural-annotations', 'word-supplements'].map(target => ({ key: target, target, label: target })),
    onRegenerate(target) { calls.push(target); const pending = deferred(); requests.set(target, pending); return pending.promise; },
  };
  const render = () => { cursor = 0; const root = context.Component(props); return Object.fromEntries(root.props.control.children[0].map(node => [node.props.key, node.props])); };
  return { render, calls, requests, props };
}

test('toolbar blocks only matching/overlapping tasks, including rapid clicks before React rerenders', async () => {
  const h = buttons(), first = h.render();
  const phonetic = first.phonetic.onClick();
  await first.phonetic.onClick(); await first.all.onClick();
  assert.deepEqual(h.calls, ['phonetic']);
  const pending = h.render();
  assert.equal(pending.phonetic.disabled, true); assert.equal(pending.all.disabled, true);
  assert.equal(pending.translation.disabled, false); assert.equal(pending['cultural-annotations'].disabled, false);
  const translation = pending.translation.onClick();
  assert.deepEqual(h.calls, ['phonetic', 'translation']);
  h.requests.get('phonetic').resolve(); await phonetic;
  assert.equal(h.render().translation.disabled, true); assert.equal(h.render().phonetic.disabled, false);
  h.requests.get('translation').reject(new Error('fixture failure')); await translation;
  assert.equal(h.render().translation.disabled, false);
  h.props.busyTargets = ['word-supplements'];
  assert.equal(h.render()['word-supplements']['aria-busy'], true);
  assert.equal(h.render().translation.disabled, false);
});
