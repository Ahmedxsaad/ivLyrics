import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');
const section = (start, end) => {
	const from = source.indexOf(start);
	const to = source.indexOf(end, from + start.length);
	assert.ok(from >= 0 && to > from, `missing production section: ${start}`);
	return source.slice(from, to);
};
const helpers = section('const SYNC_CREATOR_CHARACTER_PRONUNCIATION_CONSENT_KEY =', 'const normalizeSyncCreatorLrclibId =');
const handler = section('\tconst handleCharacterPronunciationToggle =', '\t// Visibility Observer');
const dialog = section('\t\tshowCharacterPronunciationConsent &&', '\t// Karaoke preview below');
const dialogActions = [...dialog.matchAll(/onClick: \(\) => \{([\s\S]*?)\n\t{6}\}/g)].map(match => match[1]);
assert.equal(dialogActions.length, 2, 'cancel and confirm callbacks are extracted from the shipping dialog');
const backdrop = /onClick: \(e\) => \{([\s\S]*?)\n\t{3}\}/.exec(dialog)?.[1];
assert.ok(backdrop);

function createEditor({ storage = new Map(), persistence, spicetifyStorage, localStorage, provider = true, cached = null, existing = null } = {}) {
	const requests = [], warnings = [], errors = [];
	const result = { compatible: true, lines: ['A'] };
	const context = vm.createContext({
		window: {
			ivLyricsStoragePersistence: persistence,
			Spicetify: { LocalStorage: spicetifyStorage },
			localStorage: localStorage ?? { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
			AIAddonManager: provider ? { generateCharacterPronunciation: async options => { requests.push(options); return result; } } : {},
		},
		useCallback: callback => callback,
		characterPronunciations: existing,
		lyricsLines: ['A'],
		readCachedCharacterPronunciation: async () => cached,
		isSyncCreatorCharacterPronunciationCompatible: data => data?.compatible === true,
		hasSyncCreatorCharacterPronunciation: () => true,
		getSyncCreatorCharacterPronunciationProgressInfo: () => null,
		characterPronunciationConsentForceRef: { current: false },
		characterPronunciationGenerationRequestRef: { current: 0 },
		characterPronunciationProgressOwnerRef: { current: 0 },
		characterPronunciationCacheOptions: { sourceLang: 'ja', targetLang: 'en' },
		trackId: 'fixture-a', trackName: 'Fixture', artistName: 'Artist', syncCreatorDraftStore: null,
		showCharacterPronunciations: false, showCharacterPronunciationConsent: false,
		setShowCharacterPronunciationConsent: value => { context.showCharacterPronunciationConsent = value; warnings.push(value); },
		setShowCharacterPronunciations: value => { context.showCharacterPronunciations = typeof value === 'function' ? value(context.showCharacterPronunciations) : value; },
		setCharacterPronunciations: value => { context.characterPronunciations = value; },
		setIsGeneratingCharacterPronunciations() {}, setCharacterPronunciationProgress() {},
		Toast: { error: value => errors.push(value), success() {}, warning() {} },
		I18n: { t: key => key }, console,
	});
	vm.runInContext(`${helpers}\n${handler}\nglobalThis.toggle = handleCharacterPronunciationToggle;
		globalThis.cancel = () => { ${dialogActions[0]} };
		globalThis.confirm = () => { ${dialogActions[1]} };
		globalThis.dismiss = e => { ${backdrop} };
		globalThis.hasConsent = hasSyncCreatorCharacterPronunciationConsent;
		globalThis.key = SYNC_CREATOR_CHARACTER_PRONUNCIATION_CONSENT_KEY;`, context);
	return { context, requests, warnings, errors, storage,
		toggle: options => context.toggle(options),
		async confirm() { context.confirm(); await new Promise(resolve => setImmediate(resolve)); },
	};
}

test('fresh generation asks before any AI request, cancellation and dismissal do not consent', async () => {
	const h = createEditor();
	await h.toggle();
	assert.deepEqual(h.warnings, [true]);
	assert.equal(h.requests.length, 0);
	h.context.cancel();
	assert.equal(h.context.hasConsent(), false);
	assert.equal(h.storage.size, 0);
	await h.toggle();
	h.context.dismiss({ target: 1, currentTarget: 2 });
	assert.equal(h.context.showCharacterPronunciationConsent, true, 'dialog content does not dismiss');
	h.context.dismiss({ target: 1, currentTarget: 1 });
	assert.equal(h.context.showCharacterPronunciationConsent, false);
	assert.equal(h.context.hasConsent(), false);
	await h.toggle();
	assert.equal(h.context.showCharacterPronunciationConsent, true);
	assert.equal(h.requests.length, 0);
});

test('explicit confirmation persists across songs, editor remounts and forced regeneration', async () => {
	const h = createEditor();
	await h.toggle();
	await h.confirm();
	assert.equal(h.storage.get(h.context.key), 'true');
	assert.equal(h.requests.length, 1);
	assert.equal(h.context.showCharacterPronunciationConsent, false);
	await h.toggle({ forceRegenerate: true });
	assert.equal(h.requests.length, 2);
	assert.deepEqual(h.warnings, [true, false]);
	const reopened = createEditor({ storage: h.storage });
	reopened.context.trackId = 'fixture-b';
	await reopened.toggle();
	assert.equal(reopened.requests.length, 1);
	assert.deepEqual(reopened.warnings, []);
});

test('forced request confirmed in the dialog bypasses cached pronunciation', async () => {
	const h = createEditor({ cached: { compatible: true } });
	await h.toggle({ forceRegenerate: true });
	assert.equal(h.context.characterPronunciationConsentForceRef.current, true);
	await h.confirm();
	assert.equal(h.requests.length, 1);
	assert.equal(h.context.characterPronunciationConsentForceRef.current, false);
});

test('cached and already displayed pronunciation stay free of warnings and API requests', async () => {
	for (const options of [{ cached: { compatible: true } }, { existing: { compatible: true } }]) {
		const h = createEditor(options);
		await h.toggle();
		assert.equal(h.requests.length, 0);
		assert.deepEqual(h.warnings, []);
		assert.equal(h.context.hasConsent(), false);
		assert.equal(h.context.showCharacterPronunciations, true);
	}
});

test('empty lyrics or missing provider never opens consent or generates', async () => {
	const h = createEditor({ provider: false });
	await h.toggle();
	assert.equal(h.errors.length, 1);
	assert.deepEqual(h.warnings, []);
	h.context.lyricsLines = [];
	await h.toggle();
	assert.equal(h.errors.length, 1);
});

test('consent from Research does not silently accept character-level generation costs', async () => {
	const h = createEditor({ storage: new Map([['ivLyrics:research-token-consent:v1', 'true']]) });
	await h.toggle();
	assert.equal(h.context.showCharacterPronunciationConsent, true);
	assert.equal(h.requests.length, 0);
});

test('blocked preferred storage falls back and remembers consent after remount', async () => {
	const map = new Map();
	const persistence = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
	const spicetifyStorage = { get: key => map.get(key), set: (key, value) => map.set(key, value) };
	const h = createEditor({ persistence, spicetifyStorage });
	await h.toggle(); await h.confirm();
	assert.equal(map.get(h.context.key), 'true');
	const reopened = createEditor({ persistence, spicetifyStorage });
	await reopened.toggle();
	assert.equal(reopened.requests.length, 1);
	assert.deepEqual(reopened.warnings, []);
});

test('unavailable persistent storage still remembers the explicit choice for the session', async () => {
	const h = createEditor({ localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
	await h.toggle(); await h.confirm();
	await h.toggle({ forceRegenerate: true });
	assert.equal(h.requests.length, 2);
	assert.deepEqual(h.warnings, [true, false]);
});
