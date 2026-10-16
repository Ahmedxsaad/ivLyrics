// Run with playwright-cli against the offline settings_hotfix_server.mjs.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the offline Settings fixture');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const results = [];
  for (const [width, language, theme] of [[1440, 'ko', 'dark'], [640, 'en', 'light'], [390, 'ar', 'dark']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/?language=${language}&theme=${theme}&tab=lyrics-providers`);
    await page.waitForFunction(() => window.settingsFixture?.state.ready);
    const more = page.locator('[data-setting-key="lyrics-provider:lrclib"] .settings-provider-more');
    await more.click();
    const input = page.locator('#ivlyrics-lrclib-custom-api');
    await input.waitFor();
    const text = await page.evaluate(() => {
      const prefix = 'settings.lyricsProviders.lrclibCustomApi.';
      return Object.fromEntries(['label', 'desc', 'officialOnly', 'invalid'].map(key => [key, I18n.t(prefix + key)]));
    });
    assert(await input.getAttribute('aria-describedby') === 'ivlyrics-lrclib-custom-api-desc ivlyrics-lrclib-custom-api-official', 'help text is associated with input');
    assert(await page.locator('#ivlyrics-lrclib-custom-api-official').textContent() === text.officialOnly, 'official-only explanation is localized');
    const version = await page.evaluate(() => window.LyricsAddonManager.getAddon('lrclib').cacheVersion);
    const stored = () => page.evaluate(() => window.LyricsAddonManager.getAddonSetting('lrclib', 'custom_api_endpoint', ''));
    await input.fill(' https://lyrics-cache.example/api/// ');
    assert(await stored() === '', 'editing text does not save partial addresses');
    await input.press('Enter');
    await page.waitForFunction(() => window.LyricsAddonManager.getAddonSetting('lrclib', 'custom_api_endpoint') === 'https://lyrics-cache.example/api');
    assert(await input.inputValue() === 'https://lyrics-cache.example/api', 'address is normalized on save');
    assert(await page.evaluate(() => window.LyricsAddonManager.getAddon('lrclib').cacheVersion) !== version, 'address changes invalidate provider cache');
    await input.fill('https://user:password@lyrics-cache.example/api?token=not-a-real-token');
    await input.press('Tab');
    const error = page.locator('#ivlyrics-lrclib-custom-api-error');
    await error.waitFor();
    assert(await error.textContent() === text.invalid, 'invalid address explanation is localized');
    assert(await input.getAttribute('aria-invalid') === 'true', 'invalid address has accessible state');
    assert(await stored() === 'https://lyrics-cache.example/api', 'invalid edit cannot replace the last valid address');
    await input.fill('https://other-cache.example');
    await input.press('Tab');
    assert(await stored() === 'https://other-cache.example/api', 'origin-only address gets the API path');
    await more.click(); await more.click();
    assert(await input.inputValue() === 'https://other-cache.example/api', 'reopening keeps the saved address');
    await input.fill(''); await input.press('Tab');
    assert(await stored() === '', 'empty address restores official-only loading');
    assert(await page.evaluate(() => window.LyricsAddonManager.getAddon('lrclib').cacheVersion) === version, 'clearing restores original provider cache identity');
    await input.scrollIntoViewIfNeeded();
    const metrics = await input.evaluate(element => {
      const rect = element.getBoundingClientRect(), content = document.querySelector('.settings-content');
      return { width: rect.width, height: rect.height, withinViewport: rect.left >= 0 && rect.right <= innerWidth,
        overflow: content.scrollWidth - content.clientWidth, errors: window.settingsFixture.state.errors,
        network: window.settingsFixture.state.blockedNetwork };
    });
    assert(metrics.withinViewport && metrics.width > 100 && metrics.height >= 32 && metrics.overflow <= 1, 'input fits available settings space');
    assert(metrics.errors.length === 0 && metrics.network.length === 0, 'editing settings does not cause runtime errors or network requests');
    await page.screenshot({ path: `output/playwright/lrclib-custom-api-${width}-${language}-${theme}.png` });
    results.push({ viewportWidth: width, language, theme, ...metrics });
  }
  return results;
}
