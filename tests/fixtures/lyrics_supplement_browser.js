// Run with playwright-cli --session supplement run-code --filename this-file.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Open the loopback supplement fixture first');
  const results = [];
  for (const baseline of [true, false]) {
    for (const expanded of [false, true]) for (const style of ['classic', 'expressive']) {
      await page.goto(origin + '/' + (baseline ? '?baseline=1' : ''));
      await page.waitForFunction(() => window.supplementFixture?.entries.some(entry => entry.units.size > 0));
      const result = await page.evaluate(({ expanded, style }) => {
        const f = window.supplementFixture;
        f.reset({ expanded, style });
        // Advance the actual production clock/painter into the sung word.
        for (let i = 0; i < 30; i++) f.step();
        const activeEntry = () => f.entries.find(entry => entry.data?.timedChars?.[0]?.char === 'H');
        const rootSelector = expanded ? '.lyrics-lyricsContainer-UnsyncedLyricsPage' : '.lyrics-lyricsContainer-SyncedLyrics';
        const stages = [];
        for (const kind of ['phonetic', 'translation', 'culture']) {
          const before = activeEntry();
          if (!before || before.units.size === 0) throw new Error('Missing active production units');
          const units = new Map(before.units), root = document.querySelector(rootSelector);
          const nodes = new Map([...units].map(([key, unit]) => [key, [...unit.elements]]));
          const pose = new Map([...units].map(([key, unit]) => [key, new Map(unit.values)]));
          const preparations = window.__supplementPreparations;
          f.add(kind, 1);
          const after = activeEntry();
          let replacedUnits = 0, replacedNodes = 0, changedPausedPoses = 0;
          for (const [key, unit] of units) {
            const next = after?.units.get(key);
            if (next !== unit) replacedUnits++;
            if (!next || nodes.get(key).some((node, i) => node !== next.elements[i] || !node.isConnected)) replacedNodes++;
            for (const [name, value] of pose.get(key)) if (next?.values.get(name) !== value) changedPausedPoses++;
          }
          stages.push({ kind, rootRetained: root === document.querySelector(rootSelector),
            units: units.size, replacedUnits, replacedNodes, changedPausedPoses,
            preparations: window.__supplementPreparations - preparations,
            shown: document.getElementById('root').textContent.includes(kind === 'phonetic' ? 'reading 0'
              : kind === 'translation' ? 'meaning 0' : 'Cultural explanation') });
        }
        return { expanded, style, stages };
      }, { expanded, style });
      results.push({ baseline, ...result });
    }
  }
  const control = results.filter(result => result.baseline);
  if (!control.every(result => result.stages.some(stage => !stage.rootRetained || stage.replacedUnits > 0))) {
    throw new Error('The pre-fix canary did not reproduce the generation reset: ' + JSON.stringify(control));
  }
  const fixed = results.filter(result => !result.baseline);
  for (const result of fixed) for (const stage of result.stages) {
    if (!stage.rootRetained || stage.replacedUnits || stage.replacedNodes || stage.changedPausedPoses || !stage.shown) {
      throw new Error('Supplement generation interrupted the lyric: ' + JSON.stringify(result));
    }
  }
  const playing = [];
  for (const width of [1000, 390]) for (const style of ['classic', 'expressive']) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(origin + '/');
    await page.waitForFunction(() => window.supplementFixture?.entries.some(entry => entry.units.size > 0));
    playing.push(await page.evaluate(async ({ width, style }) => {
      const f = supplementFixture;
      f.reset({ style }); f.play();
      const intervals = [], updates = [];
      let last = performance.now();
      const stages = new Map([[8, ['phonetic', 1]], [16, ['translation', 1]], [24, ['culture', 1]],
        [35, ['phonetic', 8]], [50, ['translation', 8]], [65, ['phonetic', 36]], [80, ['translation', 36]]]);
      for (let frame = 0; frame < 110; frame++) {
        await new Promise(resolve => requestAnimationFrame(now => { intervals.push(now - last); last = now; resolve(); }));
        if (!stages.has(frame)) continue;
        const before = f.entries.find(entry => entry.data?.timedChars?.[0]?.char === 'H');
        const units = new Map(before.units), started = performance.now();
        f.add(...stages.get(frame));
        const after = f.entries.find(entry => entry.data?.timedChars?.[0]?.char === 'H');
        updates.push({ kind: stages.get(frame)[0], milliseconds: performance.now() - started,
          replacements: [...units].filter(([key, unit]) => after.units.get(key) !== unit).length });
      }
      f.pause();
      const sorted = intervals.slice(2).sort((a, b) => a - b);
      return { width, style, frames: intervals.length, p95FrameMs: sorted[Math.floor(sorted.length * .95)],
        maxFrameMs: sorted.at(-1), updates };
    }, { width, style }));
  }
  if (playing.some(result => result.updates.some(update => update.replacements))) {
    throw new Error('Streaming restarted an effect during playback: ' + JSON.stringify(playing));
  }
  await page.screenshot({ path: 'output/playwright/lyrics-supplement-generation.png', fullPage: false });
  return { paused: results, playing };
}
