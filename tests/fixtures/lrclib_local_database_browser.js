// Start settings_hotfix_server.mjs and build_lrclib_local_fixture.mjs first.
// Real browser File/OPFS/IndexedDB + bundled SQLite WASM; synthetic lyrics only.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the loopback settings fixture');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const directory = 'output/playwright/lrclib-local/';
  const track = { uri: 'spotify:track:fixture', title: 'Offline Settings Song', artist: 'Fixture Artist', album: 'Fixture Album', duration: 180000 };
  const requests = [];
  const observe = request => { if (/^https?:/.test(request.url())) requests.push(request.url()); };
  page.on('request', observe);
  const open = async (width = 1440, language = 'en', theme = 'dark') => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${origin}/?language=${language}&theme=${theme}&tab=lyrics-providers`);
    await page.waitForFunction(() => window.settingsFixture?.state.ready);
    await page.locator('[data-setting-key="lyrics-provider:lrclib"] .settings-provider-more').click();
    await page.waitForFunction(() => !['opening', 'importing'].includes(window.IvLyricsLocalLrclib.getState().phase));
    requests.length = 0;
  };
  const importFile = async name => {
    // Native picker route is tested separately. Feed the same File object into
    // the production import API so the batch needs no OS chooser interception.
    await page.evaluate(() => {
      document.getElementById('fixture-local-file')?.remove();
      const input = document.createElement('input'); input.type = 'file'; input.id = 'fixture-local-file'; input.hidden = true;
      window.fixtureLocalImport = { done: false };
      input.onchange = async () => {
        try { window.fixtureLocalImport.result = await window.IvLyricsLocalLrclib.importFile(input.files[0]); }
        catch (error) { window.fixtureLocalImport.error = error.code; }
        finally { window.fixtureLocalImport.done = true; }
      };
      document.body.appendChild(input);
    });
    await page.locator('#fixture-local-file').setInputFiles(directory + name);
    await page.waitForFunction(() => window.fixtureLocalImport.done);
    return page.evaluate(() => window.fixtureLocalImport);
  };
  try {
    await open();
    await page.evaluate(() => window.IvLyricsLocalLrclib.remove());
    assert((await importFile('fixture.sqlite3')).result.phase === 'ready', 'real indexed SQLite database opens');
    const first = await page.evaluate(async info => window.LyricsAddonManager.getAddon('lrclib').getLyrics(info), track);
    assert(first.lrclibApiSource === 'local' && first.synced[0].text === 'Local first line', 'production provider returns local lyrics');
    assert(!first.lrclibId && !first.lrclibSource, 'local source cannot seed official sync submissions');
    const queries = await page.evaluate(async () => ({
      accent: await window.IvLyricsLocalLrclib.lookup({ title: 'Café - Song', artist: 'Beyoncé', album: 'Album', duration: 180000 }),
      long: (await window.IvLyricsLocalLrclib.lookup({ title: 'Long Song', artist: 'Fixture Artist', duration: 180000 }))?.plainLyrics.length,
      instrumental: await window.IvLyricsLocalLrclib.lookup({ title: 'Instrumental', artist: 'Fixture Artist', duration: 180000 }),
      missing: await window.IvLyricsLocalLrclib.lookup({ title: 'Missing', artist: 'Nobody', duration: 180000 })
    }));
    assert(queries.accent.id === 2 && queries.long === 40000 && queries.instrumental.instrumental && queries.missing === null, 'SQLite matching, overflow pages and misses work');
    assert(requests.length === 0, 'local playback needs no API or runtime dependency download');
    for (const [name, code] of [['invalid.sqlite3.gz', 'invalidFile'], ['wrong-schema.sqlite3', 'invalidDatabase']]) {
      assert((await importFile(name)).error === code, 'invalid files are rejected');
      await page.evaluate(() => window.IvLyricsLocalLrclib.connect());
      assert((await page.evaluate(async info => window.IvLyricsLocalLrclib.lookup(info), track))?.id === 1, 'failed replacement preserves previous database');
    }
    assert((await importFile('fixture.sqlite3.gz')).result.phase === 'ready', 'gzip import streams to OPFS and validates');
    const revision = await page.evaluate(() => window.IvLyricsLocalLrclib.getCacheVersion());
    await open();
    await page.evaluate(() => window.IvLyricsLocalLrclib.connect());
    assert(await page.evaluate(() => window.IvLyricsLocalLrclib.getCacheVersion()) === revision, 'compressed database restores after a page restart');
    assert((await page.evaluate(async info => window.LyricsAddonManager.getAddon('lrclib').getLyrics(info), track)).lrclibApiSource === 'local', 'restored database serves playback');
    assert(requests.length === 0, 'restored playback remains fully offline');
    const fallback = await page.evaluate(async info => {
      const native = window.fetch, seen = [];
      const addon = window.LyricsAddonManager.getAddon('lrclib');
      window.LyricsAddonManager.setAddonSetting('lrclib', 'custom_api_endpoint', 'https://custom.example/api');
      window.fetch = async url => {
        seen.push(url);
        if (String(url).startsWith('https://custom.example/api')) return new Response(null, { status: 404 });
        if (!String(url).startsWith('https://lrclib.net/api/')) throw new Error('Unexpected destination');
        const record = { id: 777, trackName: info.title, artistName: info.artist, albumName: info.album,
          duration: 180, syncedLyrics: '[00:01.00]Official fixture', plainLyrics: 'Official fixture' };
        return Response.json(new URL(url).pathname.endsWith('/search') ? [record] : record);
      };
      try {
        const result = await addon.getLyrics(info);
        const firstRequests = [...seen]; seen.length = 0;
        const official = await addon.getLyrics({ ...info, lrclibOfficialOnly: true });
        return { result, firstRequests, official, officialRequests: seen };
      } finally {
        window.fetch = native;
        window.LyricsAddonManager.setAddonSetting('lrclib', 'custom_api_endpoint', '');
      }
    }, { ...track, title: 'Missing Local Song' });
    assert(fallback.firstRequests.length === 6 && fallback.firstRequests.slice(0, 5).every(url => url.startsWith('https://custom.example/api/')) &&
      fallback.firstRequests[5].startsWith('https://lrclib.net/api/get?') && fallback.result.lrclibId === '777', 'missing local data exhausts custom lookup/search before official lookup');
    assert(fallback.officialRequests.length === 1 && fallback.officialRequests[0].startsWith('https://lrclib.net/api/') &&
      fallback.official.lrclibId === '777', 'official-only loading bypasses both local and custom');
    const views = [];
    for (const [width, language, theme] of [[1440, 'en', 'dark'], [390, 'ko', 'light']]) {
      await open(width, language, theme);
      await page.locator('[data-lrclib-local-state="ready"]').scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => {
        const content = document.querySelector('.settings-content');
        return { overflow: content.scrollWidth - content.clientWidth,
          errors: window.settingsFixture.state.errors, network: window.settingsFixture.state.blockedNetwork };
      });
      assert(geometry.overflow <= 1 && geometry.errors.length === 0 && geometry.network.length === 0, 'settings UI has no overflow or runtime errors');
      await page.screenshot({ path: `output/playwright/lrclib-local-${width}-${language}-${theme}.png` });
      views.push({ width, language, theme, ...geometry });
    }
    await page.evaluate(() => window.IvLyricsLocalLrclib.remove());
    const cleanup = await page.evaluate(async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('ivlyrics-lrclib-local');
      const names = []; for await (const name of directory.keys()) names.push(name);
      return { names, state: window.IvLyricsLocalLrclib.getState() };
    });
    assert(cleanup.state.phase === 'empty' && cleanup.names.length === 0, 'disconnect removes only app-owned unpacked cache');
    return { sqlite: 'real indexed SQLite', gzip: 'streamed and restored', queries: ['accent', 'overflow', 'instrumental', 'miss'],
      fallbacks: 'local -> custom -> official; editor official-only', views, cleanedUp: true };
  } finally { page.off('request', observe); }
}
