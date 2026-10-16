// Production addon in a real browser, with synthetic responses only.
// Run against settings_hotfix_server.mjs with playwright-cli run-code --filename.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the offline Settings fixture');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const output = [];
  for (const [width, language, theme] of [[1440, 'en', 'dark'], [390, 'ko', 'light']]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${origin}/?language=${language}&theme=${theme}&tab=lyrics-providers`);
    await page.waitForFunction(() => window.settingsFixture?.state.ready);
    await page.locator('[data-setting-key="lyrics-provider:lrclib"] .settings-provider-more').click();
    const field = page.locator('#ivlyrics-lrclib-custom-api');
    await field.fill('https://mirror.example.test/api');
    await field.press('Enter');
    await page.waitForFunction(() => window.LyricsAddonManager.getAddonSetting('lrclib', 'custom_api_endpoint') === 'https://mirror.example.test/api');
    const cases = await page.evaluate(async () => {
      const addon = window.LyricsAddonManager.getAddon('lrclib');
      const originalFetch = window.fetch, originalSync = window.SyncDataService, originalLyrics = window.LyricsService;
      const track = { uri: 'spotify:track:routingFixture', title: 'Routing Song', artist: 'Fixture Artist', album: 'Fixture Album', duration: 180000 };
      const record = { id: 90210, trackName: track.title, artistName: track.artist, albumName: track.album,
        duration: 180, syncedLyrics: '[00:01.00]First line\n[00:02.00]Second line', plainLyrics: 'First line\nSecond line' };
      const source = { provider: 'lrclib', lrclibId: '90210', preferredLyricsSource: 'synced', lineCharCounts: [10, 11] };
      const results = [];
      try {
        for (const scenario of ['mirror-id', 'mirror-search', 'mirror-miss', 'both-miss', 'wrong-mirror-source', 'editor']) {
          const requests = []; let syncReads = 0;
          const pinned = !['mirror-search', 'both-miss'].includes(scenario);
          window.LyricsService = { ...originalLyrics, extractTrackId: () => 'routingFixture' };
          window.SyncDataService = { ...originalSync, getSyncData: async () => { syncReads++; return pinned ? { source } : null; } };
          window.fetch = async (input, options) => {
            const url = new URL(String(input));
            const custom = url.hostname === 'mirror.example.test';
            if (!custom && url.hostname !== 'lrclib.net') throw new Error('Unexpected network destination');
            requests.push({ host: custom ? 'mirror' : 'official', path: url.pathname, query: url.search });
            if (custom && (options.credentials !== 'omit' || options.redirect !== 'error' || options.method !== 'GET')) throw new Error('Unsafe mirror request');
            if (custom && scenario === 'mirror-id' && url.pathname.endsWith('/get/90210')) return Response.json(record);
            if (custom && scenario === 'mirror-search' && url.pathname.endsWith('/search')) return Response.json([record]);
            if (custom && scenario === 'wrong-mirror-source') {
              const wrong = { ...record, id: 123, syncedLyrics: '[00:01.00]Wrong revision', plainLyrics: 'Wrong revision' };
              return Response.json(url.pathname.endsWith('/search') ? [wrong] : wrong);
            }
            if (!custom && scenario !== 'both-miss') return Response.json(url.pathname.endsWith('/search') ? [record] : record);
            return url.pathname.endsWith('/search') ? Response.json([]) : new Response(null, { status: 404 });
          };
          const result = await addon.getLyrics({ ...track, ...(scenario === 'editor' ? { lrclibOfficialOnly: true } : {}) });
          results.push({ scenario, requests, syncReads, source: result.lrclibApiSource, id: result.lrclibId, error: result.error,
            text: (result.synced || result.unsynced || []).map(line => line.text) });
        }
      } finally { window.fetch = originalFetch; window.SyncDataService = originalSync; window.LyricsService = originalLyrics; }
      return results;
    });
    for (const item of cases) {
      assert(item.syncReads === 1, `${item.scenario}: resolve the pinned source only once`);
      if (item.scenario === 'mirror-id') assert(item.requests.length === 1 && item.requests[0].path === '/api/get/90210' && item.source === 'custom' && item.id === '90210', 'saved ID is first read on the mirror and retained after validation');
      if (item.scenario === 'mirror-search') assert(item.requests.length === 2 && item.requests.every(request => request.host === 'mirror') && item.source === 'custom' && !item.id, 'a metadata miss continues to mirror search, without trusting private IDs');
      if (['mirror-miss', 'wrong-mirror-source'].includes(item.scenario)) {
        const firstOfficial = item.requests.findIndex(request => request.host === 'official');
        assert(firstOfficial === 6 && item.requests.length === 7 && item.requests[6].path === '/api/get/90210', 'complete mirror ID/get/search ladder precedes official pinned-ID lookup');
        assert(item.id === '90210' && item.text[0] === 'First line', 'wrong mirror revision cannot replace the pinned source');
      }
      if (item.scenario === 'both-miss') assert(item.requests.length === 10 && item.requests.slice(0, 5).every(request => request.host === 'mirror') && item.requests.slice(5).every(request => request.host === 'official') && item.error, 'both complete host ladders fail before returning provider failure');
      if (item.scenario === 'editor') assert(item.requests.length === 1 && item.requests[0].host === 'official', 'editor loading remains official-only');
    }
    await field.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => window.settingsFixture.state.errors.length === 0 && window.settingsFixture.state.blockedNetwork.length === 0), 'no runtime errors or real external requests');
    await page.screenshot({ path: `output/playwright/lrclib-host-fallback-${width}-${language}.png` });
    output.push({ width, language, cases });
  }
  return output;
}
