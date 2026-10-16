// Production toolbar/pill UI with local-only storage and player events stubbed.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use the offline first_use_server fixture');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const results = [];
  for (const [width, language, theme] of [[1100, 'en', 'dark'], [390, 'ko', 'light']]) {
    await page.setViewportSize({ width, height: 840 });
    await page.goto(`${origin}/?surface=toolbar&language=${language}&theme=${theme}`);
    await page.evaluate(() => {
      ReactDOM.unmountComponentAtNode(document.getElementById('toolbar'));
      window.videoOffsetWrites = [];
      Utils.updateSelectedVideoSyncOffset = async (uri, info) => window.videoOffsetWrites.push({ uri, ...info });
      window.ivLyricsActiveCommunityVideoInfo = { trackUri: track.uri, youtubeVideoId: 'fixture-a', captionStartTime: 5, videoDurationSeconds: 120 };
      ReactDOM.render(React.createElement(React.Fragment, null,
        React.createElement(IvLyricsFloatingToolbar, {
          actions: {}, isFullscreen: false, isMenuOpen: true, isMenuClosing: false, modeKey: 'synced',
          hasLyrics: true, hasSynced: true, hasKaraoke: false, karaokeEnabled: true,
          isLyricsLoading: false, trackUri: track.uri, syncTrackUri: track.uri,
          trackTitle: track.name, trackArtist: 'Fixture', lyrics,
        }),
        React.createElement('div', { id: 'quick-video-fixture' }, React.createElement(CurrentVideoSyncPill, {
          trackUri: track.uri, hideWhenEmpty: true,
        }))
      ), document.getElementById('toolbar'));
    });
    const pill = page.locator('#quick-video-fixture');
    await pill.getByRole('button', { name: /\+100ms$/ }).click();
    assert((await pill.textContent()).includes('5.100s'), 'quick readout updates');
    await page.locator('.ivl-tb-item[data-entry="sync"]').click();
    const panel = page.locator('[data-section="video-sync"]');
    assert((await panel.textContent()).includes('5.100s'), 'panel sees the same live anchor');
    await panel.getByRole('button', { name: /\+1s$/ }).click();
    assert((await pill.textContent()).includes('6.100s'), 'panel adjustment synchronizes the pill');
    await page.screenshot({ path: `output/playwright/video-offset-${width}-${language}.png` });
    await page.evaluate(() => {
      window.ivLyricsActiveCommunityVideoInfo = { trackUri: track.uri, youtubeVideoId: 'fixture-b', captionStartTime: 9, videoDurationSeconds: 120 };
      window.dispatchEvent(new CustomEvent('ivLyrics:communityVideoChanged', { detail: { trackUri: track.uri } }));
    });
    assert((await pill.textContent()).includes('9.000s'), 'a new video refreshes the controls');
    await pill.getByRole('button', { name: /\+10ms$/ }).click();
    // Clicking the quick pill intentionally dismisses the floating flyout.
    if (await panel.count() === 0) await page.locator('.ivl-tb-item[data-entry="sync"]').click();
    assert((await panel.textContent()).includes('9.010s'), 'edits target the newly selected video');
    const writes = await page.evaluate(() => window.videoOffsetWrites);
    assert(writes.at(-1).youtubeVideoId === 'fixture-b', 'no stale previous-video write');
    await page.evaluate(() => {
      window.ivLyricsActiveCommunityVideoInfo = null;
      window.dispatchEvent(new CustomEvent('ivLyrics:communityVideoChanged', { detail: { trackUri: track.uri } }));
    });
    assert(await page.locator('[data-section="video-sync"]').count() === 0, 'empty video removes its panel section');
    assert(await pill.locator('button').count() === 0, 'empty video removes quick buttons');
    results.push({ width, language, theme, localWrites: writes.length });
  }
  return results;
}
