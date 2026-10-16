// Run against first_use_server.mjs using playwright-cli run-code --filename.
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use the offline loopback fixture');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const results = [];
  for (const [width, language, theme] of [[1100, 'en', 'dark'], [390, 'ko', 'light']]) {
    await page.setViewportSize({ width, height: 840 });
    await page.goto(`${origin}/?surface=toolbar&language=${language}&theme=${theme}`);
    const labels = await page.evaluate(() => {
      window.lyricContainerUpdate = () => {};
      ReactDOM.unmountComponentAtNode(document.getElementById('toolbar'));
      const choices = getRegenerateTranslationChoiceItems({
        targets: { needPhonetic: true, needTranslation: true }, includeCulturalAnnotations: true, includeWordSupplements: true,
      });
      const requests = new Map(); window.regenerationRequests = requests;
      const actions = {
        getRegenerateChoices: () => choices,
        onRegenerate: target => new Promise(resolve => requests.set(target, resolve)),
      };
      ReactDOM.render(React.createElement(IvLyricsFloatingToolbar, {
        actions, isFullscreen: false, isMenuOpen: true, isMenuClosing: false, modeKey: 'synced',
        hasLyrics: true, hasSynced: true, hasKaraoke: false, karaokeEnabled: true,
        isLyricsLoading: false, canRegenerate: true, showConvert: true, friendlyLanguage: 'japanese',
        trackUri: track.uri, syncTrackUri: track.uri, trackTitle: track.name, trackArtist: 'Fixture', lyrics,
      }), document.getElementById('toolbar'));
      return Object.fromEntries(choices.map(choice => [choice.target, choice.label]));
    });
    await page.locator('.ivl-tb-item[data-entry="convert"]').click();
    const button = target => page.getByRole('button', { name: labels[target], exact: true });
    await button('phonetic').click();
    assert(await button('phonetic').isDisabled(), 'the requested pronunciation is busy');
    assert(await button('all').isDisabled(), 'the overlapping combined request is busy');
    assert(await button('translation').isEnabled(), 'translation remains independently usable');
    assert(await button('cultural-annotations').isEnabled(), 'cultural annotations remain independently usable');
    await button('translation').click(); await button('cultural-annotations').click();
    assert(await button('word-supplements').isEnabled(), 'word details remain available while three other jobs run');
    await button('word-supplements').click();
    assert(await page.evaluate(() => window.regenerationRequests.size) === 4, 'four independent actions launched');
    await page.screenshot({ path: `output/playwright/parallel-regeneration-${width}-${language}-pending.png` });
    await page.evaluate(() => window.regenerationRequests.get('phonetic')());
    await button('phonetic').waitFor();
    assert(await button('phonetic').isEnabled(), 'pronunciation unlocks independently');
    assert(await button('translation').isDisabled(), 'finishing pronunciation does not unlock translation');
    await page.evaluate(() => { for (const resolve of window.regenerationRequests.values()) resolve(); });
    assert(await button('all').isEnabled(), 'combined action unlocks after both fields complete');
    await page.screenshot({ path: `output/playwright/parallel-regeneration-${width}-${language}-complete.png` });
    results.push({ width, language, theme, jobs: 4 });
  }
  return results;
}
