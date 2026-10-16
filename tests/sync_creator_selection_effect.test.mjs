import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `missing production section: ${startMarker}`);
	return source.slice(start, end);
};

const context = vm.createContext({});
vm.runInContext(
	slice('const shouldUseSyncCreatorSelectionEffect =', 'const isSyncCreatorIndexLocked =') +
	'\nglobalThis.__helpers = { shouldUseSyncCreatorSelectionEffect, resolveSyncCreatorSelectionEffectKind, resolveSyncCreatorSelectionSpeaker, formatSyncCreatorSelectedSubtitle, resolveSyncCreatorPaintCharColor };',
	context
);
const {
	shouldUseSyncCreatorSelectionEffect,
	resolveSyncCreatorSelectionEffectKind,
	resolveSyncCreatorSelectionSpeaker,
	formatSyncCreatorSelectedSubtitle,
	resolveSyncCreatorPaintCharColor,
} = context.__helpers;
const plain = value => JSON.parse(JSON.stringify(value));

test('idle/preview selections target exact ranges on normal, split and grouped vocals', () => {
	for (const activeParallelPart of [null, { id: 'b' }, { id: 'background', ranges: [{ start: 3, end: 4 }, { start: 8, end: 9 }] }]) {
		for (const mode of ['idle', 'preview']) {
			for (const offsetSelectionRange of [{ start: 1, end: 2 }, { start: 0, end: 0 }]) {
				assert.equal(shouldUseSyncCreatorSelectionEffect({ mode, activeParallelPart, offsetSelectionRange }), true);
			}
		}
		assert.equal(shouldUseSyncCreatorSelectionEffect({ mode: 'record', activeParallelPart, offsetSelectionRange: { start: 1, end: 2 } }), false);
		for (const offsetSelectionRange of [null, {}, { start: -1, end: 1 }, { start: 2, end: 1 }, { start: 0.5, end: 1 }, { start: 0, end: Infinity }, { start: '0', end: 1 }]) {
			assert.equal(shouldUseSyncCreatorSelectionEffect({ mode: 'idle', activeParallelPart, offsetSelectionRange }), false);
		}
	}
});

test('selection effect kind is the uniform kind across selected refs, empty when mixed or unstyled', () => {
	const charRefs = [{ absoluteIndex: 3 }, { absoluteIndex: 4 }, { absoluteIndex: 5 }];
	const ranges = [{ start: 3, end: 5, kind: 'echo' }];
	assert.equal(resolveSyncCreatorSelectionEffectKind({ styleRanges: ranges, charRefs, range: { start: 0, end: 2 } }), 'echo');
	assert.equal(resolveSyncCreatorSelectionEffectKind({ styleRanges: [], charRefs, range: { start: 0, end: 2 } }), '');
	assert.equal(
		resolveSyncCreatorSelectionEffectKind({ styleRanges: [{ start: 3, end: 3, kind: 'echo' }, { start: 4, end: 5, kind: 'glow' }], charRefs, range: { start: 0, end: 2 } }),
		''
	);
	assert.equal(resolveSyncCreatorSelectionEffectKind({ styleRanges: ranges, charRefs, range: null }), '');
});

test('selected subtitle matches range-editor format and truncates long text', () => {
	assert.equal(
		formatSyncCreatorSelectedSubtitle({ selectedText: 'BC', startLabel: 2, endLabel: 3, selectedLabel: 'Selected' }),
		'Selected: “BC” (2–3)'
	);
	const long = formatSyncCreatorSelectedSubtitle({ selectedText: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', startLabel: 1, endLabel: 26, selectedLabel: 'Selected', maxLength: 24 });
	assert.ok(long.includes('…'), 'long text must be truncated');
	assert.ok(long.includes('(1–26)'));
	assert.equal(formatSyncCreatorSelectedSubtitle({ selectedText: '', startLabel: 1, endLabel: 1, selectedLabel: 'Selected' }), '');
});

test('progress painters keep the partial speaker color instead of resetting to the line color', () => {
	assert.equal(resolveSyncCreatorPaintCharColor('#a8ccff', '#f2f4f7', '#f2f4f7'), '#a8ccff');
	assert.equal(resolveSyncCreatorPaintCharColor('', '#f2f4f7', '#e8e8e8'), '#f2f4f7');
	assert.equal(resolveSyncCreatorPaintCharColor('', '', '#e8e8e8'), '#e8e8e8');
});

test('selection speaker is the uniform speaker meta across selected refs, null when mixed or unstyled', () => {
	const charRefs = [{ absoluteIndex: 3 }, { absoluteIndex: 4 }, { absoluteIndex: 5 }];
	const ranges = [{ start: 3, end: 5, kind: 'glow', speaker: 'MALE 1' }];
	assert.deepEqual(
		plain(resolveSyncCreatorSelectionSpeaker({ styleRanges: ranges, charRefs, range: { start: 0, end: 2 } })),
		{ speaker: 'MALE 1', 'speaker-color': '', 'speaker-fallback': '' }
	);
	const custom = [{ start: 3, end: 5, speaker: 'CUSTOM', 'speaker-color': '#123abc', 'speaker-fallback': 'DUET 1' }];
	assert.deepEqual(
		plain(resolveSyncCreatorSelectionSpeaker({ styleRanges: custom, charRefs, range: { start: 0, end: 2 } })),
		{ speaker: 'CUSTOM', 'speaker-color': '#123abc', 'speaker-fallback': 'DUET 1' }
	);
	assert.equal(resolveSyncCreatorSelectionSpeaker({ styleRanges: [], charRefs, range: { start: 0, end: 2 } }), null);
	assert.equal(resolveSyncCreatorSelectionSpeaker({ styleRanges: [{ start: 3, end: 5, kind: 'glow' }], charRefs, range: { start: 0, end: 2 } }), null);
	assert.equal(
		resolveSyncCreatorSelectionSpeaker({ styleRanges: [{ start: 3, end: 3, speaker: 'MALE 1' }, { start: 4, end: 5, speaker: 'FEMALE 1' }], charRefs, range: { start: 0, end: 2 } }),
		null
	);
	assert.equal(resolveSyncCreatorSelectionSpeaker({ styleRanges: ranges, charRefs, range: null }), null);
});

test('the redundant bottom partial-effects tab is removed; main picker and speaker panel cover selection', () => {
	assert.ok(!source.includes('const renderStyleRangeEditor ='), 'range editor function is gone');
	assert.ok(!source.includes('renderStyleRangeColorColumn'), 'range color column is gone');
	const stage = slice('const renderStagePanel =', 'const renderLineOffsetControls =');
	assert.ok(!stage.includes('renderStyleRangeEditor'), 'stage no longer renders the tab');
});

test('clearing a styled range removes its effect and color but keeps neighbors', () => {
	const helpers = vm.createContext({ window: {}, I18n: { t: () => '' }, CONFIG: { visual: {} }, localStorage: { getItem: () => null } });
	const take = (s, e) => {
		const a = source.indexOf(s);
		const b = source.indexOf(e, a + s.length);
		assert.ok(a >= 0 && b > a, `missing section: ${s}`);
		return source.slice(a, b);
	};
	vm.runInContext([
		take('const SYNC_CREATOR_SPEAKER_OPTIONS =', 'const hasSyncCreatorCharacterPronunciationConsent ='),
		take('const SYNC_CREATOR_KIND_OPTIONS =', 'const SYNC_CREATOR_PARALLEL_HINT_REGEX ='),
		take('const normalizeSyncCreatorSpeakerToken =', 'const getSyncCreatorHexColorWithAlpha ='),
		take('const normalizeSyncCreatorKind =', 'const getSyncCreatorParenthesisClose ='),
	].join('\n') + '\nglobalThis.__clear = { normalizeSyncCreatorStyleRanges, applySyncCreatorStyleRangePatch };', helpers);
	const { normalizeSyncCreatorStyleRanges, applySyncCreatorStyleRangePatch } = helpers.__clear;
	const lineStart = 100;
	const lineEnd = 109;
	const ranges = [
		{ start: 100, end: 102, kind: 'glow', speaker: 'MALE 1' },
		{ start: 103, end: 105, kind: 'echo', speaker: 'FEMALE 1' },
		{ start: 106, end: 109, kind: 'whisper', speaker: 'MALE 2' },
	];
	const cleared = applySyncCreatorStyleRangePatch(ranges, 103, 105, { kind: null, speaker: null }, lineStart, lineEnd);
	assert.deepEqual(plain(cleared), [
		{ start: 100, end: 102, kind: 'glow', speaker: 'MALE 1' },
		{ start: 106, end: 109, kind: 'whisper', speaker: 'MALE 2' },
	]);
	assert.deepEqual(plain(normalizeSyncCreatorStyleRanges(cleared, lineStart, lineEnd)), plain(cleared));
});

test('the speaker panel header carries a selection-gated clear-style button', () => {
	const inspector = slice('const renderLineInspector =', 'const renderGranularitySelector =');
	assert.ok(inspector.includes('rangeStyleClear'), 'clear button lives in the speaker panel');
	assert.ok(inspector.includes('hasInspectorSelectionTarget'), 'clear button follows the selection');
});
