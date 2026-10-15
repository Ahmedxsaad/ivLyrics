import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Spotify fades audio in after a seek, which can swallow the first syllable of
// a clicked line. The opt-in seek-fade-compensation setting lands 300 ms early.

// Reuse the lyric row selection harness.
const selectionUrl = new URL('./lyrics_selection_feedback.test.mjs', import.meta.url);
const selectionSource = readFileSync(selectionUrl, 'utf8');
const selectionStart = selectionSource.indexOf('const source =');
const selectionEnd = selectionSource.indexOf('\ntest(');
assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
const selectionHarness = new Function('assert', 'readFileSync', 'vm',
  `${selectionSource.slice(selectionStart, selectionEnd).replaceAll('import.meta.url', JSON.stringify(selectionUrl.href))}\nreturn harness;`)(
  assert, readFileSync, vm);

test('seek fade compensation is opt-in and lands 300 ms before the line without going negative', () => {
  const h = selectionHarness();
  h.render().props.onClick(h.event());
  assert.deepEqual(h.events.filter(Array.isArray), [['seek', 1250]], 'default seeks exactly to the line');

  h.CONFIG.visual['seek-fade-compensation'] = true;
  h.events.length = 0;
  h.render().props.onClick(h.event());
  assert.deepEqual(h.events.filter(Array.isArray), [['seek', 950]]);

  h.events.length = 0;
  h.render({ seekTime: 120 }).props.onClick(h.event());
  assert.deepEqual(h.events.filter(Array.isArray), [['seek', 0]]);
});
