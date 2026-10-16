async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the loopback settings fixture');
  const results = [];
  for (const language of ['ko', 'en', 'ar']) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({width: 1200, height: 820});
    await page.goto(origin + '/?language=' + language + '&theme=' + theme + '&tab=general');
    const title = page.getByRole('heading', {name: 'ivLyrics', exact: true, level: 1});
    await title.waitFor({state: 'visible'});
    const appearance = await title.evaluate(heading => {
      const [iv, lyrics] = heading.children;
      const bounds = heading.getBoundingClientRect();
      return {text: heading.textContent, direction: getComputedStyle(heading).direction,
        ivWeight: getComputedStyle(iv).fontWeight, lyricsWeight: getComputedStyle(lyrics).fontWeight,
        gap: lyrics.getBoundingClientRect().left - iv.getBoundingClientRect().right,
        contained: bounds.left >= 0 && bounds.right <= innerWidth,
        errors: window.__settingsFixtureState.errors, blocked: window.__settingsFixtureState.blockedNetwork};
    });
    if (appearance.text !== 'ivLyrics' || appearance.direction !== 'ltr' || appearance.ivWeight !== '800'
      || appearance.lyricsWeight !== '250' || Math.abs(appearance.gap) > 0.1 || !appearance.contained
      || appearance.errors.length || appearance.blocked.length) {
      throw new Error('Invalid wordmark: ' + JSON.stringify({language, theme, ...appearance}));
    }
    await page.screenshot({path: 'output/playwright/settings-wordmark-' + language + '-' + theme + '.png'});
    results.push({language, theme, ...appearance});
  }
  return {passed: results.length, results};
}
