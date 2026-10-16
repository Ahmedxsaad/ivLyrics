import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createLockedEditor } from './sync_creator_lock_harness.mjs';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const section = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `missing production section: ${startMarker}`);
	return source.slice(start, end);
};
const styleMemo = section('\tconst currentLineStyleRanges = useMemo(', '\tconst getParallelTemplateForLine =');
const charMemo = section('\tconst currentLineCharRefs = useMemo(', '\tscoreInputContextRef.current =');
const styleCallback = section('\tconst updateCurrentLineStyleRanges =', '\tconst applySongVocalSpeaker =');
const styleRenderer = section('\tconst renderStyleRangeEditor =', '\tconst renderStagePanel =');

function* nodes(tree) {
	if (tree === null || tree === undefined || typeof tree === 'boolean') return;
	if (Array.isArray(tree)) {
		for (const child of tree) yield* nodes(child);
	} else {
		yield tree;
		if (typeof tree === 'object') yield* nodes(tree.children);
	}
}

// Reuse the existing production-backed mouse/keyboard host, without changing it.
// Add only the shipping style memo, updater and renderer. State setters can be
// queued like React's batched updates; selection itself is never manufactured.
function createStyleEditor({ text = 'ABCDEFGH', mode = 'idle' } = {}) {
	const h = createLockedEditor({ text, saved: Array.from(text, (_, i) => 10 + i * 0.25) });
	const c = h.context;
	const queued = [];
	let deferWrites = false, claims = 0;
	Object.assign(c, {
		mode, offsetSelectionRange: null, currentLineText: c.currentLineChars.join(''),
		styleRangeEffect: '', styleRangeSpeaker: 'NORMAL', styleRangeSpeakerColor: '',
		styleRangeSpeakerFallback: 'MALE 1', isStyleRangeEditorExpanded: true,
		bulkCustomSpeakerColor: '', bulkCustomSpeakerFallback: 'MALE 1', TOSS_BORDER: '#333', s: {},
		claimSessionForLocalEditing() { claims++; },
		react: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
		renderTextEffectPicker: (value, onChange, options) => ({ type: 'effect-picker', props: { value, onChange, ...options } }),
		renderSpeakerPicker: (value, color, fallback, onChange, options) => ({ type: 'speaker-picker', props: { value, color, fallback, onChange, ...options } }),
	});
	for (const name of ['styleRangeEffect', 'styleRangeSpeaker', 'styleRangeSpeakerColor', 'styleRangeSpeakerFallback', 'isStyleRangeEditorExpanded']) {
		c[`set${name[0].toUpperCase()}${name.slice(1)}`] = update => {
			c[name] = typeof update === 'function' ? update(c[name]) : update;
		};
	}
	for (const name of ['lineStyleDrafts', 'syncData']) {
		c[`set${name[0].toUpperCase()}${name.slice(1)}`] = update => {
			const apply = () => { c[name] = typeof update === 'function' ? update(c[name]) : update; };
			if (deferWrites) queued.push(apply);
			else apply();
		};
	}
	const render = (selected = c.activeParallelPartId, { refreshTarget = true } = {}) => {
		if (refreshTarget) h.render(selected);
		// The shared offset host always picks a vocal. With multi-vocal mode
		// off, use the shipping full-row character memos instead.
		if (!c.multiVocalMode) {
			Object.assign(c, { activeParallelPart: null, activeParallelTargetId: 'full', activeParallelPartId: 'full' });
			vm.runInContext(`Object.assign(globalThis, (() => {
				${charMemo}
				return { currentLineCharRefs, currentLineChars };
			})());`, c);
		}
		c.currentLineText = c.currentLineChars.join('');
		vm.runInContext(`Object.assign(globalThis, (() => {
			${styleMemo}
			${styleCallback}
			${styleRenderer}
			return { currentLineStyleRanges, updateCurrentLineStyleRanges, renderStyleRangeEditor };
		})());`, c);
	};
	const picker = type => {
		const node = [...nodes(c.renderStyleRangeEditor())].find(node => node?.type === type);
		assert.ok(node, `${type} must be rendered`);
		assert.equal(node.props.disabled, false, `${type} must be enabled for the visible selection`);
		return node;
	};
	render();
	return {
		...h, render,
		get claims() { return claims; },
		selection: () => plain(c.offsetSelectionRangeRef.current),
		style: patch => c.updateCurrentLineStyleRanges(patch),
		chooseEffect(value) { render(); picker('effect-picker').props.onChange(value); },
		chooseSpeaker(value) { render(); picker('speaker-picker').props.onChange(value); },
		styleTree: () => c.renderStyleRangeEditor(),
		deferWrites() { deferWrites = true; },
		flushWrites() { deferWrites = false; while (queued.length) queued.shift()(); },
	};
}

const withoutStyles = data => ({ ...plain(data), lines: plain(data.lines).map(({ styleRanges, ...line }) => line) });
const styleAt = (ranges, index) => {
	const range = ranges?.find(range => range.start <= index && range.end >= index);
	if (!range) return null;
	const { start, end, ...meta } = plain(range);
	return meta;
};
const lineStyles = h => h.line().styleRanges || [];

test('without a visible lyric selection the effect and color controls are disabled and cannot write styles', () => {
	const h = createStyleEditor();
	const before = plain(h.context.syncData);
	for (const type of ['effect-picker', 'speaker-picker']) {
		const picker = [...nodes(h.styleTree())].find(node => node?.type === type);
		assert.ok(picker);
		assert.equal(picker.props.disabled, true);
	}
	assert.equal(h.style({ kind: 'echo', speaker: 'FEMALE 1' }), false);
	assert.equal(h.claims, 0);
	assert.deepEqual(plain(h.context.syncData), before);
});

test('normal-row right-click reaches the real partial-effect picker and a second click disarms it', () => {
	const h = createStyleEditor();
	const before = withoutStyles(h.context.syncData);
	h.contextMenu(2);
	h.chooseEffect('whisper');
	assert.deepEqual(plain(lineStyles(h)), [{ start: 5, end: 5, kind: 'whisper' }]);
	assert.deepEqual(plain(h.context.lineStyleDrafts[3]), plain(lineStyles(h)));
	assert.deepEqual(withoutStyles(h.context.syncData), before, 'styling must not change saved timing, vocal metadata or other rows');
	h.contextMenu(2);
	assert.equal(h.selection(), null);
	assert.equal(h.style({ kind: 'echo' }), false);
	assert.deepEqual(plain(lineStyles(h)), [{ start: 5, end: 5, kind: 'whisper' }]);
});

for (const mode of ['idle', 'preview']) {
	for (const [start, end] of [[1, 3], [3, 1]]) {
		test(`${mode}: right-drag ${start} to ${end} styles exactly that span and consumes the trailing context menu`, () => {
			const h = createStyleEditor({ mode });
			const before = withoutStyles(h.context.syncData);
			h.rightDrag(start, end);
			assert.deepEqual(h.selection(), { start: 1, end: 3 });
			assert.equal(h.style({ kind: 'echo' }), true, 'the synchronous selection ref works even before a React rerender');
			assert.deepEqual(plain(lineStyles(h)), [{ start: 4, end: 6, kind: 'echo' }]);
			assert.deepEqual(withoutStyles(h.context.syncData), before);
		});
	}
}

test('record-mode right-click and right-drag remain timing locks, never partial styles', () => {
	const h = createStyleEditor();
	h.contextMenu(1);
	const before = plain(h.context.syncData);
	h.context.mode = 'record';
	h.render();
	assert.ok(h.selection(), 'the updater must reject a record-mode edit even before the clearing effect runs');
	assert.equal(h.styleTree(), null);
	assert.equal(h.style({ kind: 'echo' }), false);
	h.resetSelection({ mode: 'record' });
	h.contextMenu(2);
	h.rightDrag(3, 4);
	assert.deepEqual(plain(h.context.getActiveRecordingLockRange()), { start: 3, end: 4 });
	assert.equal(h.selection(), null);
	h.render();
	assert.equal(h.styleTree(), null, 'record mode must not expose an effect picker for a timing lock');
	assert.equal(h.style({ kind: 'whisper', speaker: 'FEMALE 1' }), false);
	assert.equal(h.claims, 0);
	assert.deepEqual(plain(h.context.syncData), before);
	assert.deepEqual(plain(h.context.lineStyleDrafts), {});
});

test('full-row right-drag remains visible and styles the entire row', () => {
	const h = createStyleEditor();
	h.rightDrag(0, 7);
	assert.deepEqual(h.selection(), { start: 0, end: 7 });
	h.chooseEffect('glow');
	assert.deepEqual(plain(lineStyles(h)), [{ start: 3, end: 10, kind: 'glow' }]);
	assert.equal(vm.runInContext('resolveSyncCreatorOffsetSelectionRange(0, 7, 8)', h.context), null, 'the pure offset API keeps its existing whole-line fallback');
});

test('a full-row style selection still shifts the whole row rather than neighbor-clamping it as a partial offset', () => {
	const h = createStyleEditor();
	const original = plain(h.line().chars);
	h.rightDrag(0, 7);
	h.api.adjustCurrentLineOffset(1000);
	assert.deepEqual(plain(h.line().chars), original.map(time => time + 1));
	assert.deepEqual(h.selection(), { start: 0, end: 7 }, 'offsetting does not destroy the full-row style selection');
	assert.equal(h.style({ kind: 'echo' }), true);
});

test('contiguous parallel-vocal selection maps into the selected part, not the source-row prefix', () => {
	const h = createStyleEditor();
	h.split(3); h.render('b');
	const before = withoutStyles(h.context.syncData);
	assert.equal(h.context.currentLineText, 'DEFGH');
	h.rightDrag(0, 1);
	h.chooseEffect('whisper');
	assert.deepEqual(plain(lineStyles(h)), [{ start: 6, end: 7, kind: 'whisper' }]);
	assert.equal(styleAt(lineStyles(h), 3), null, 'the first source character must never inherit a later vocal selection');
	assert.deepEqual(withoutStyles(h.context.syncData), before);
	const labels = [...nodes(h.styleTree())].filter(node => typeof node === 'string').join(' ');
	assert.match(labels, /“DE”/);
	assert.match(labels, /\(4–5\)/, 'selection labels are positions in the full row, not in the shortened vocal');
});

test('noncontiguous parallel vocals patch only the exact selected refs and leave the gaps untouched', () => {
	const h = createStyleEditor({ text: 'AB (CD) EF (GH)' });
	h.context.parentheticalLayoutDrafts[3] = 'grouped';
	h.render();
	const grouped = h.context.currentParallelParts.find(part => part.ranges.length > 1);
	assert.ok(grouped, 'the production parenthetical template must expose a noncontiguous vocal');
	h.render(grouped.id);
	const selectedRefs = h.context.currentLineCharRefs.slice(1, 3);
	assert.ok(selectedRefs[1].absoluteIndex > selectedRefs[0].absoluteIndex + 1, 'the fixture must cross a real source-row gap');
	const before = withoutStyles(h.context.syncData);
	h.rightDrag(1, 2);
	h.chooseEffect('echo');
	const selectedIndexes = new Set(selectedRefs.map(ref => ref.absoluteIndex));
	for (let index = 3; index <= h.line().end; index++) {
		assert.deepEqual(styleAt(lineStyles(h), index), selectedIndexes.has(index) ? { kind: 'echo' } : null, `absolute character ${index}`);
	}
	assert.deepEqual(withoutStyles(h.context.syncData), before, 'all parallel timing arrays, ranges and vocal metadata stay identical');
	const pending = [...h.context.scorePendingEffectsRef.current.values()].at(-1);
	assert.deepEqual(plain(pending.ranges), plain(selectedRefs.map(ref => ({ start: ref.absoluteIndex, end: ref.absoluteIndex }))), 'effect scoring must not claim the unselected gap either');
});

test('a full parallel-vocal selection styles that vocal, while offsets retain whole-part semantics', () => {
	const h = createStyleEditor();
	h.split(4); h.render('b');
	const before = plain(h.context.currentParallelData.parts);
	h.rightDrag(0, 3);
	h.chooseEffect('whisper');
	assert.deepEqual(plain(lineStyles(h)), [{ start: 7, end: 10, kind: 'whisper' }]);
	h.api.adjustCurrentLineOffset(1000);
	const after = plain(h.line().parallel.parts);
	assert.deepEqual(after[0].chars, before[0].chars, 'the sibling vocal keeps its original timings');
	assert.deepEqual(after[1].chars, before[1].chars.map(time => time + 1));
	assert.deepEqual(plain(lineStyles(h)), [{ start: 7, end: 10, kind: 'whisper' }]);
});

for (const change of ['line', 'part', 'text', 'same-text remap']) {
	test(`a stale selection cannot style a changed ${change} before the clearing effect runs`, () => {
		const h = createStyleEditor();
		h.rightDrag(1, 2);
		const before = plain(h.context.syncData);
		const c = h.context;
		if (change === 'line') { c.currentLineIndex = 2; c.currentLineStart = 11; }
		if (change === 'part') c.activeParallelTargetId = 'different-vocal';
		if (change === 'text') c.currentLineChars = Array.from('XXXXXXXX');
		if (change === 'same-text remap') c.currentLineCharRefs = c.currentLineCharRefs.map((ref, i, all) => ({ ...ref, absoluteIndex: all[(i + 1) % all.length].absoluteIndex }));
		h.render(undefined, { refreshTarget: false });
		assert.ok(h.selection(), 'do not run the selection-clearing effect; the updater itself must reject the old owner');
		assert.equal(h.style({ kind: 'echo' }), false);
		assert.equal(h.claims, 0, 'reject stale ownership before claiming a local edit');
		assert.deepEqual(plain(c.syncData), before);
		assert.deepEqual(plain(c.lineStyleDrafts), {});
	});
}

for (const changes of [{ currentLineIndex: 2 }, { activeParallelTargetId: 'other' }, { mode: 'record' }]) {
	test(`the real clearing effect disarms both selection and its owner after ${Object.keys(changes)[0]} changes`, () => {
		const h = createStyleEditor();
		h.rightDrag(1, 2);
		h.context.isRightOffsetDraggingRef.current = true;
		h.context.rightOffsetDragStartRef.current = 1;
		h.resetSelection(changes);
		assert.equal(h.selection(), null);
		assert.equal(h.context.offsetSelectionTargetRef.current, null);
		assert.equal(h.context.isRightOffsetDraggingRef.current, false);
		assert.equal(h.context.rightOffsetDragStartRef.current, -1);
		assert.equal(h.style({ kind: 'whisper' }), false);
	});
}

test('editing an effect preserves the selected color metadata and untargeted styled spans', () => {
	const h = createStyleEditor();
	const custom = { speaker: 'CUSTOM', 'speaker-color': '#123abc', 'speaker-fallback': 'DUET 1' };
	h.line().styleRanges = [
		{ start: 3, end: 3, kind: 'echo', speaker: 'MALE 1' },
		{ start: 4, end: 8, kind: 'glow', ...custom },
		{ start: 9, end: 10, kind: 'whisper', speaker: 'FEMALE 1' },
	];
	h.render();
	const before = withoutStyles(h.context.syncData);
	h.rightDrag(2, 3);
	assert.equal(h.style({ kind: 'echo' }), true);
	assert.deepEqual(styleAt(lineStyles(h), 5), { kind: 'echo', ...custom });
	assert.deepEqual(styleAt(lineStyles(h), 6), { kind: 'echo', ...custom });
	assert.deepEqual(styleAt(lineStyles(h), 4), { kind: 'glow', ...custom });
	assert.deepEqual(styleAt(lineStyles(h), 8), { kind: 'glow', ...custom });
	assert.deepEqual(styleAt(lineStyles(h), 3), { kind: 'echo', speaker: 'MALE 1' });
	assert.deepEqual(styleAt(lineStyles(h), 10), { kind: 'whisper', speaker: 'FEMALE 1' });
	assert.deepEqual(withoutStyles(h.context.syncData), before);
});

test('the speaker picker changes only selected color metadata, preserving existing text effects', () => {
	const h = createStyleEditor();
	h.line().styleRanges = [{ start: 3, end: 10, kind: 'echo', speaker: 'MALE 1' }];
	h.render();
	h.rightDrag(1, 2);
	h.chooseSpeaker('FEMALE 1');
	for (let index = 3; index <= 10; index++) {
		assert.deepEqual(styleAt(lineStyles(h), index), { kind: 'echo', speaker: index === 4 || index === 5 ? 'FEMALE 1' : 'MALE 1' });
	}
});

test('batched effect and color writes compose from the latest draft and saved state without rerendering', () => {
	const h = createStyleEditor();
	h.rightDrag(1, 2);
	const before = withoutStyles(h.context.syncData);
	h.deferWrites();
	assert.equal(h.style({ kind: 'whisper' }), true);
	assert.equal(h.style({ speaker: 'CUSTOM', 'speaker-color': '#12ab34', 'speaker-fallback': 'DUET 1' }), true);
	h.flushWrites();
	const expected = [{ start: 4, end: 5, kind: 'whisper', speaker: 'CUSTOM', 'speaker-color': '#12ab34', 'speaker-fallback': 'DUET 1' }];
	assert.deepEqual(plain(lineStyles(h)), expected);
	assert.deepEqual(plain(h.context.lineStyleDrafts[3]), expected);
	assert.deepEqual(withoutStyles(h.context.syncData), before);
});

test('batched writes to two successive selections preserve both spans and unrelated draft rows', () => {
	const h = createStyleEditor();
	h.context.lineStyleDrafts[0] = [{ start: 0, end: 1, kind: 'echo' }];
	h.rightDrag(1, 2);
	h.deferWrites();
	assert.equal(h.style({ kind: 'whisper' }), true);
	h.contextMenu(6);
	assert.equal(h.style({ kind: 'glow' }), true);
	h.flushWrites();
	const expected = [{ start: 4, end: 5, kind: 'whisper' }, { start: 9, end: 9, kind: 'glow' }];
	assert.deepEqual(plain(lineStyles(h)), expected);
	assert.deepEqual(plain(h.context.lineStyleDrafts[3]), expected);
	assert.deepEqual(plain(h.context.lineStyleDrafts[0]), [{ start: 0, end: 1, kind: 'echo' }]);
});

test('styling a merged display row patches each source record without replacing the later row metadata', () => {
	const h = createStyleEditor({ text: 'ABCD' });
	const c = h.context;
	c.multiVocalMode = false;
	c.mergedLineDrafts[3] = [7];
	c.syncData.lines[1].styleRanges = [{ start: 3, end: 6, kind: 'echo', speaker: 'MALE 1' }];
	c.syncData.lines[2].styleRanges = [{ start: 7, end: 10, kind: 'glow', speaker: 'FEMALE 1' }];
	c.syncData.lines[2].note = { keep: 'later-row' };
	h.render();
	assert.equal(c.currentLineText, 'ABCDTAIL');
	const before = withoutStyles(c.syncData);
	h.rightDrag(2, 5);
	assert.equal(h.style({ kind: 'whisper' }), true);
	assert.deepEqual(plain(c.syncData.lines[1].styleRanges), [
		{ start: 3, end: 4, kind: 'echo', speaker: 'MALE 1' },
		{ start: 5, end: 6, kind: 'whisper', speaker: 'MALE 1' },
	]);
	assert.deepEqual(plain(c.syncData.lines[2].styleRanges), [
		{ start: 7, end: 8, kind: 'whisper', speaker: 'FEMALE 1' },
		{ start: 9, end: 10, kind: 'glow', speaker: 'FEMALE 1' },
	]);
	assert.deepEqual(withoutStyles(c.syncData), before);
});

test('clear-style action removes only the chosen span and keeps neighboring style metadata and timing', () => {
	const h = createStyleEditor();
	h.line().styleRanges = [{ start: 3, end: 10, kind: 'echo', speaker: 'FEMALE 1' }];
	h.rightDrag(2, 3);
	h.render();
	const before = withoutStyles(h.context.syncData);
	const clear = [...nodes(h.styleTree())].find(node => node?.type === 'button' && node.children.includes('syncCreator.rangeStyleClear'));
	assert.ok(clear);
	assert.equal(clear.props.disabled, false);
	clear.props.onClick();
	assert.deepEqual(plain(lineStyles(h)), [
		{ start: 3, end: 4, kind: 'echo', speaker: 'FEMALE 1' },
		{ start: 7, end: 10, kind: 'echo', speaker: 'FEMALE 1' },
	]);
	assert.deepEqual(withoutStyles(h.context.syncData), before);
});

test('style selection helper merges exact adjacent indices, not the hidden gaps or unselected refs', () => {
	const h = createStyleEditor();
	const ranges = vm.runInContext(`getSyncCreatorStyleSelectionRanges(
		{start: 1, end: 4},
		[3, 7, 8, 11, 12, 14].map(absoluteIndex => ({absoluteIndex})), 3, 14
	)`, h.context);
	assert.deepEqual(plain(ranges), [{ start: 7, end: 8 }, { start: 11, end: 12 }]);
	for (const expression of [
		'null, [{absoluteIndex:3}], 3, 10',
		'{start:-1,end:0}, [{absoluteIndex:3}], 3, 10',
		'{start:0,end:1}, [{absoluteIndex:3}], 3, 10',
		'{start:1,end:0}, [{absoluteIndex:3},{absoluteIndex:4}], 3, 10',
		'{start:0,end:0}, [{absoluteIndex:2}], 3, 10',
		'{start:0,end:0}, [{absoluteIndex:11}], 3, 10',
		'{start:0,end:0}, [{}], 3, 10',
	]) assert.deepEqual(plain(vm.runInContext(`getSyncCreatorStyleSelectionRanges(${expression})`, h.context)), [], expression);
});

test('astral Unicode characters use character refs rather than UTF-16 byte or code-unit offsets', () => {
	const h = createStyleEditor({ text: 'A🎵漢字B' });
	const before = withoutStyles(h.context.syncData);
	h.rightDrag(1, 2);
	h.chooseEffect('glow');
	assert.deepEqual(plain(lineStyles(h)), [{ start: 4, end: 5, kind: 'glow' }]);
	const labels = [...nodes(h.styleTree())].filter(node => typeof node === 'string').join(' ');
	assert.match(labels, /“🎵漢”/);
	assert.deepEqual(withoutStyles(h.context.syncData), before);
});
