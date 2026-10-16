import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// Partial effects (style ranges) are driven by the main lyric line's
// right-click selection in preview/idle. The old dedicated left-drag
// selection (styleRangeSelection + char grid) is gone.
const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const section = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.ok(start >= 0, `missing source section: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(end > start, `missing source section end: ${endMarker}`);
	return source.slice(start, end);
};

test('style ranges apply to the right-click offset selection', () => {
	const apply = section('const updateCurrentLineStyleRanges =', 'const applySongVocalSpeaker =');
	assert.ok(apply.includes('offsetSelectionRange'), 'must read the right-click selection');
	assert.ok(!apply.includes('styleRangeSelection'), 'must not read the removed grid selection');
});

test('left-drag style selection method is removed', () => {
	for (const token of [
		'beginStyleRangeSelection',
		'extendStyleRangeSelection',
		'styleRangeDragRef',
		'renderStyleRangeCharGrid',
	]) {
		assert.ok(!source.includes(token), `removed method still present: ${token}`);
	}
	assert.ok(!source.includes('styleRangeSelection'), 'removed selection state still present');
});

test('style editor hides in record mode', () => {
	const editor = section('const renderStyleRangeEditor =', 'const renderStagePanel =');
	assert.ok(
		editor.includes("mode === 'record'"),
	 'editor must gate on record mode since right-click there means lock'
	);
});

test('effects hint describes right-drag selection in every locale', () => {
	const files = readdirSync(new URL('../langs', import.meta.url)).filter((file) => file.endsWith('.js'));
	assert.ok(files.length >= 22, `expected 22 locale files, found ${files.length}`);
	for (const file of files) {
		const strings = readFileSync(new URL(`../langs/${file}`, import.meta.url), 'utf8');
		assert.ok(strings.includes('rangeStyleHint'), `${file}: missing rangeStyleHint`);
	}
	const english = readFileSync(new URL('../langs/LangEn.js', import.meta.url), 'utf8');
	assert.ok(
		english.includes('Right-drag'),
		'English hint must describe the right-drag gesture'
	);
});
