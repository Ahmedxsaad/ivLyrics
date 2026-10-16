// Run with the loopback-only first_use_server fixture. Real production React
// controls; local writes/submissions are stubs, never account or API operations.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use the local first-use fixture');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const results = [];
  for (const [width, language, theme, paneWidth = width] of [
    [1100, 'en', 'dark'], [390, 'ko', 'light'], [320, 'en', 'dark'], [1100, 'en', 'light', 440],
  ]) {
    await page.setViewportSize({ width, height: 840 });
    await page.goto(`${origin}/?surface=toolbar&language=${language}&theme=${theme}`);
    await page.evaluate((paneWidth) => {
      ReactDOM.unmountComponentAtNode(document.getElementById('toolbar'));
      // Spotify provides a full-size positioned host. Reproduce that scaffold,
      // not the fixture's flex-item sizing, without altering production controls.
      document.getElementById('toolbar').style.cssText = `position:absolute;inset:0;width:${paneWidth}px;height:100%;`;
      window.quickSyncWrites = [];
      window.quickSyncSubmissions = [];
      window.ivLyrics_firstLyricTime = 10000;
      Utils.updateSelectedVideoSyncOffset = async (uri, info) => window.quickSyncWrites.push({ uri, ...info });
      Utils.submitCommunityVideo = async (...args) => { window.quickSyncSubmissions.push(args); return { success: true }; };
      window.ivLyricsActiveCommunityVideoInfo = {
        trackUri: track.uri, youtubeVideoId: 'fixture-a', captionStartTime: 5,
        videoDurationSeconds: 120, playerReady: true,
      };
      ReactDOM.render(React.createElement(React.Fragment, null,
        React.createElement(IvLyricsFloatingToolbar, {
          actions: {}, isFullscreen: false, isMenuOpen: true, isMenuClosing: false, modeKey: 'synced',
          hasLyrics: true, hasSynced: true, hasKaraoke: false, karaokeEnabled: true,
          isLyricsLoading: false, trackUri: track.uri, syncTrackUri: track.uri,
          trackTitle: track.name, trackArtist: 'Fixture', lyrics,
        }),
        React.createElement('div', { className: 'lyrics-quick-sync-stack', id: 'quick-sync-fixture' },
          React.createElement(TrackSyncAdjustPill, { trackUri: track.uri, lyricsAdjustable: true, videoTrackUri: track.uri }))
      ), document.getElementById('toolbar'));
    }, paneWidth);
    const labels = await page.evaluate(() => ({ video: I18n.t('videoSync.title'), share: I18n.t('videoSync.share') }));
    const pill = page.locator('#quick-sync-fixture');
    await pill.getByRole('button', { name: labels.video, exact: true }).click();
    await pill.getByRole('button', { name: /\+0\.1s$/ }).click();
    assert(Math.abs(await page.evaluate(() => window.ivLyricsActiveCommunityVideoInfo.captionStartTime) - 5.1) < 0.0001,
      'quick step updates the canonical absolute anchor');
    assert(await page.evaluate(() => window.quickSyncSubmissions.length) === 0, 'steps never auto-submit');
    await page.keyboard.press(']');
    assert(Math.abs(await page.evaluate(() => window.ivLyricsActiveCommunityVideoInfo.captionStartTime) - 5.2) < 0.0001,
      'bracket key uses the same anchor');
    await page.locator('.ivl-tb-item[data-entry="sync"]').click();
    const panel = page.locator('[data-section="video-sync"]');
    assert((await panel.textContent()).includes('5.200s'), 'toolbar sees quick-sync changes');
    await panel.getByRole('button', { name: /\+1s$/ }).click();
    assert((await pill.locator('.lyrics-track-sync-value-current').textContent()).includes('6.200s'),
      'panel and floating pill share one source of truth');
    await pill.getByRole('button', { name: labels.share, exact: true }).click();
    assert(await page.evaluate(() => window.quickSyncSubmissions.length) === 1, 'explicit share submits once');
    const shared = await page.evaluate(() => window.quickSyncSubmissions[0]);
    assert(shared[0] === 'spotify:track:fixture' && shared[1] === 'fixture-a' && Math.abs(shared[3] - 6.2) < 0.0001,
      'share keeps the clicked track, video and exact start point');
    const layout = await pill.locator('.lyrics-track-sync-pill').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    assert(layout.left >= 0 && layout.right <= paneWidth && layout.scrollWidth <= layout.clientWidth + 1,
      `quick controls must fit without clipped buttons: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: `output/playwright/video-quick-sync-${width}-${paneWidth}-${language}.png` });
    await page.evaluate(() => {
      window.ivLyricsActiveCommunityVideoInfo = {
        trackUri: track.uri, youtubeVideoId: 'fixture-b', captionStartTime: 9,
        playerReady: true, videoDurationSeconds: 120,
      };
      window.dispatchEvent(new CustomEvent('ivLyrics:communityVideoChanged', { detail: { trackUri: track.uri } }));
    });
    await pill.getByRole('button', { name: /\+0\.1s$/ }).click();
    const write = await page.evaluate(() => window.quickSyncWrites.at(-1));
    assert(write.youtubeVideoId === 'fixture-b' && Math.abs(write.captionStartTime - 9.1) < 0.0001,
      'switching videos cannot save a stale video');
    await page.evaluate(() => {
      window.ivLyricsActiveCommunityVideoInfo = null;
      window.dispatchEvent(new CustomEvent('ivLyrics:communityVideoChanged', { detail: { trackUri: track.uri } }));
    });
    assert(await pill.getByRole('button', { name: labels.video, exact: true }).count() === 0,
      'video switch disappears when no video is active');
    results.push({ width, paneWidth, language, theme, layout, explicitShares: 1, staleVideoGuard: true });
  }
  return results;
}
