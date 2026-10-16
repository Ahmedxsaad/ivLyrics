// Run after the ordinary local DB browser batch, against its loopback fixture.
// Real cross-tab Web Locks/IDB/OPFS and an actual navigation during validation.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the loopback settings fixture');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const open = async target => {
    await target.goto(`${origin}/?language=en&theme=dark&tab=lyrics-providers`);
    await target.waitForFunction(() => window.settingsFixture?.state.ready);
    await target.evaluate(() => window.IvLyricsLocalLrclib.connect());
  };
  const names = target => target.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('ivlyrics-lrclib-local');
    const result = []; for await (const name of directory.keys()) result.push(name);
    return result.sort();
  });
  const importGzip = async (target, wait = true) => {
    await target.evaluate(() => {
      document.getElementById('fixture-lifecycle-file')?.remove();
      const input = document.createElement('input'); input.type = 'file'; input.id = 'fixture-lifecycle-file'; input.hidden = true;
      window.fixtureLifecycle = { done: false };
      input.onchange = async () => {
        try { window.fixtureLifecycle.result = await window.IvLyricsLocalLrclib.importFile(input.files[0]); }
        catch (error) { window.fixtureLifecycle.error = error.code; }
        finally { window.fixtureLifecycle.done = true; }
      };
      document.body.appendChild(input);
    });
    await target.locator('#fixture-lifecycle-file').setInputFiles('output/playwright/lrclib-local/fixture.sqlite3.gz');
    if (wait) {
      await target.waitForFunction(() => window.fixtureLifecycle.done);
      const result = await target.evaluate(() => window.fixtureLifecycle);
      assert(result.result?.phase === 'ready', `gzip import succeeds: ${result.error || ''}`);
    }
  };
  const second = await page.context().newPage();
  try {
    await open(page);
    assert(await page.evaluate(() => !!navigator.locks), 'real Web Locks are available');
    await page.evaluate(() => window.IvLyricsLocalLrclib.remove());
    await importGzip(page); // Database A, restored by the second tab.
    await open(second);
    assert(await second.evaluate(() => window.IvLyricsLocalLrclib.getState().phase) === 'ready', 'second tab holds A');
    await importGzip(page); // B replaces A.
    await importGzip(second); // Stale A context must replace/clean B, not A again.
    assert((await names(second)).length === 1, 'stale contexts cannot orphan replaced databases');
    await second.evaluate(() => window.IvLyricsLocalLrclib.remove());
    assert((await names(second)).length === 0, 'removal cleans the actual persisted reference');

    await importGzip(page);
    const original = (await names(page))[0];
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.fixtureStalledOpen = false;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...rest) {
          if (message.action === 'open') { window.fixtureStalledOpen = true; return; }
          return super.postMessage(message, ...rest);
        }
      };
    });
    await importGzip(page, false);
    await page.waitForFunction(() => window.fixtureStalledOpen);
    assert((await names(page)).length === 2, 'replacement has a fully unpacked file awaiting validation');
    await open(page); // Interrupt before validation/metadata commit; releases its Web Lock.
    const remaining = await names(page);
    assert(remaining.length === 1 && remaining[0] === original, 'restart removes abandoned output and preserves the active database');
    const found = await page.evaluate(() => window.IvLyricsLocalLrclib.lookup({
      title: 'Offline Settings Song', artist: 'Fixture Artist', album: 'Fixture Album', duration: 180000
    }));
    assert(found?.id === 1, 'last-good database still serves lyrics after interrupted replacement');
    await page.evaluate(() => window.IvLyricsLocalLrclib.remove());
    assert((await names(page)).length === 0, 'only app-owned test output was cleaned up');
    return { staleTabReplacement: 'no orphaned database', interruptedValidation: 'recovered; last-good preserved', cleanedUp: true };
  } finally { await second.close(); }
}
