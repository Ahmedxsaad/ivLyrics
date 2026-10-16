// Open karaoke_expressive_server.mjs, then:
// playwright-cli -s=pr125 run-code --filename tests/fixtures/karaoke_expressive_browser.js
// Uses the production renderer, stylesheet, live entries and painter. This is
// offline browser acceptance, not installed Spotify playback acceptance.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Open the loopback Expressive fixture first');
  const errors = [], external = [], results = [];
  const onError = error => errors.push(error.message);
  const onRequest = request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); };
  page.on('pageerror', onError);
  page.on('request', onRequest);
  const apply = options => page.evaluate(options => window.expressiveFixture.apply(options), options);
  const read = () => page.evaluate(() => [...document.querySelectorAll('.preview-row')].map(row => ({
    id: row.dataset.case,
    fills: [...row.querySelectorAll('.lyrics-karaoke-glyph-fill')].map(node => node.textContent),
    fillWidths: [...row.querySelectorAll('.lyrics-karaoke-glyph-fill')].map(node => node.offsetWidth),
    readings: [...row.querySelectorAll('.lyrics-karaoke-char-reading,.lyrics-karaoke-run-reading,rt')].map(node => node.textContent),
    words: row.querySelectorAll('.lyrics-karaoke-word').length,
    runs: [...row.querySelectorAll('.lyrics-karaoke-text-run-segment')].map(node => ({text: node.dataset.outlineText, dir: node.dir, range: node.style.getPropertyValue('--ivlyrics-range-index')})),
    width: row.offsetWidth, height: row.offsetHeight,
    hostHeight: row.querySelector('.lyric-host').offsetHeight,
  })));
  const sameLayout = (actual, expected, label) => assert(JSON.stringify(actual) === JSON.stringify(expected), label + ': shaping, readings or layout changed');
  const motion = () => page.evaluate(() => [...document.querySelectorAll('[data-karaoke-live],.is-bouncing')].map(node => ({
    y: node.style.getPropertyValue('--karaoke-bounce-y'),
    scale: node.style.getPropertyValue('--karaoke-bounce-scale'),
    glow: node.style.getPropertyValue('--karaoke-motion-glow'),
    fill: node.style.getPropertyValue('--karaoke-char-fill'),
  })));
  const noTransforms = () => page.evaluate(() => [...document.querySelectorAll('.lyrics-karaoke-char,.lyrics-karaoke-text-run-segment,.lyrics-karaoke-word')].every(node => {
    const value = getComputedStyle(node).transform;
    return value === 'none' || new DOMMatrix(value).isIdentity;
  }));
  const waitForRest = () => page.waitForFunction(() => [...document.querySelectorAll('.lyrics-karaoke-char,.lyrics-karaoke-text-run-segment,.lyrics-karaoke-word')].every(node => {
    const transform = getComputedStyle(node).transform;
    return transform === 'none' || new DOMMatrix(transform).isIdentity;
  }));

  try {
    for (const width of [1000, 390]) for (const live of [false, true]) {
      await page.setViewportSize({width, height: 1000});
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await page.goto(origin);
      await page.waitForFunction(() => window.expressiveFixture?.entryCount > 0);
      await page.evaluate(() => document.fonts.ready);
      await apply({style: 'classic', position: 900, live, bounce: true, effects: true, reduced: false});
      const classic = await read();
      assert(classic.length === 11, 'all stable source fixtures must render');
      assert(classic.find(row => row.id === 'unspaced').words === 0, 'unspaced source must keep its original break opportunities');
      assert(classic.find(row => row.id === 'cjk').readings.includes('かん'), '#126 ruby must render');
      await apply({style: 'unset'});
      sameLayout(await read(), classic, 'default equals Classic');
      await apply({style: 'expressive'});
      sameLayout(await read(), classic, 'Expressive pending pose');
      await page.evaluate(() => {
        window.fixtureShapedNodes = [...document.querySelectorAll('[data-case="accent"] .lyrics-karaoke-text-run-segment,[data-case="arabic"] .lyrics-karaoke-text-run-segment')];
        window.expressiveFixture.seek(1000);
        window.expressiveFixture.tick(48);
      });
      const active = await motion();
      assert(active.some(unit => unit.y.endsWith('em')), 'Expressive motion must be painted in em units');
      assert(active.some(unit => Number(unit.glow) > 0), 'Text Effects must paint spring glow');
      assert(active.some(unit => parseFloat(unit.fill) > 0 && parseFloat(unit.fill) < 100), 'source fill must advance');
      sameLayout(await read(), classic, 'Expressive active pose');
      if (live) assert(await page.evaluate(() => window.expressiveFixture.entryCount >= 11), 'production live painter must own each visible line');
      const activeScreenshot = 'output/playwright/pr125-expressive-' + width + '-' + (live ? 'live' : 'react') + '.png';
      await page.screenshot({path: activeScreenshot, fullPage: true});

      const paused = JSON.stringify(await motion());
      await page.evaluate(() => window.expressiveFixture.repaint());
      assert(JSON.stringify(await motion()) === paused, 'paused commits must not advance springs');
      for (const position of [6000, 900, 1250]) {
        await page.evaluate(position => window.expressiveFixture.seek(position), position);
        sameLayout(await read(), classic, 'seek to ' + position);
        assert(await page.evaluate(() => window.fixtureShapedNodes.every(node => node.isConnected)), 'shaped DOM must survive completion and seeks');
      }

      await apply({effects: false});
      assert((await motion()).every(unit => !unit.glow || Number(unit.glow) === 0), 'Text Effects off must remove glow');
      assert((await motion()).some(unit => unit.y.endsWith('em')), 'Text Effects off must retain spring motion');
      await apply({bounce: false});
      assert(await page.locator('.is-motion-expressive').count() === 0, 'Bounce off must remove Expressive presentation');
      // Existing Classic rules ease back to identity over 75 ms.
      await waitForRest();
      assert(await noTransforms(), 'Bounce off must remove the pending rest pose too');
      sameLayout(await read(), classic, 'Bounce off');

      await apply({bounce: true, effects: true, position: 1000});
      await page.evaluate(() => window.expressiveFixture.tick(24));
      assert(await page.locator('.is-motion-expressive').count() > 0, 'restore Expressive before reduced-motion test');
      // Change OS preference without a React commit: production CSS must remove
      // transforms and transitions from both active units and pending rest poses.
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.waitForFunction(() => [...document.querySelectorAll('.is-motion-expressive .lyrics-karaoke-char,.is-motion-expressive .lyrics-karaoke-word,.is-motion-expressive .lyrics-karaoke-text-run-segment')]
        .every(node => getComputedStyle(node).transform === 'none' && getComputedStyle(node).transitionDuration === '0s'));
      assert(await noTransforms(), 'OS reduced motion must take effect before rendering again');
      await apply({});
      assert(await page.locator('.is-motion-expressive').count() === 0, 'OS reduced motion must disable production Expressive calculations');
      await waitForRest();
      assert(await noTransforms(), 'the live Classic fallback must not reintroduce motion under OS reduced motion');
      sameLayout(await read(), classic, 'OS reduced motion');
      const reducedScreenshot = 'output/playwright/pr125-reduced-' + width + '-' + (live ? 'live' : 'react') + '.png';
      await page.screenshot({path: reducedScreenshot, fullPage: true});

      await page.emulateMedia({reducedMotion: 'no-preference'});
      await apply({reduced: true});
      await waitForRest();
      assert(await page.locator('.is-motion-expressive').count() === 0 && await noTransforms(), 'app reduced motion must disable springs and rest poses');
      sameLayout(await read(), classic, 'app reduced motion');
      results.push({width, live, rows: classic.length, activeScreenshot, reducedScreenshot});
    }
    assert(errors.length === 0, 'browser errors: ' + errors.join('; '));
    assert(external.length === 0, 'fixture requested an external dependency: ' + external.join('; '));
    return {passed: results.length, results, pageErrors: errors, externalRequests: external};
  } finally {
    page.off('pageerror', onError);
    page.off('request', onRequest);
    await page.emulateMedia({reducedMotion: 'no-preference'});
  }
}
