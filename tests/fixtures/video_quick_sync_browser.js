// Run with the loopback-only first_use_server fixture. Real production React
// controls; local writes/submissions are stubs, never account or API operations.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use the local first-use fixture');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const checkRoundedShell = async (pill) => {
    const shape = await pill.locator('.lyrics-track-sync-pill').evaluate(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      const radius = (node) => {
        const bounds = node.getBoundingClientRect();
        return Math.min(parseFloat(getComputedStyle(node).borderTopLeftRadius), bounds.width / 2, bounds.height / 2);
      };
      const outerRadius = radius(element), mode = element.querySelector('.lyrics-track-sync-mode');
      const toggle = mode?.querySelector('button'), share = element.querySelector('.lyrics-track-sync-share');
      const nested = (node, parent) => !node || Math.abs(radius(node) - Math.min(
        node.getBoundingClientRect().width / 2, node.getBoundingClientRect().height / 2,
        radius(parent) - (node.getBoundingClientRect().top - parent.getBoundingClientRect().top)
      )) < 0.6;
      const buttonsFit = [...element.querySelectorAll('button')].every(button => {
        const bounds = button.getBoundingClientRect();
        return bounds.left >= rect.left && bounds.right <= rect.right + 0.5 && bounds.top >= rect.top && bounds.bottom <= rect.bottom + 0.5;
      });
      // A square descendant covering the corners must be clipped by the shell,
      // including while feedback or hover surfaces are being painted.
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;inset:-8px;z-index:100;pointer-events:auto;background:magenta;';
      element.append(probe);
      let cornersClipped, centerVisible;
      try {
        cornersClipped = [rect.left + 0.75, rect.right - 0.75].every(x =>
          [rect.top + 0.75, rect.bottom - 0.75].every(y => document.elementFromPoint(x, y) !== probe));
        centerVisible = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === probe;
      } finally { probe.remove(); }
      return {
        outerRadius, overflowX: style.overflowX, overflowY: style.overflowY,
        backgroundClip: style.backgroundClip, cornersClipped, centerVisible, buttonsFit,
        nestedRadii: nested(mode, element) && nested(toggle, mode),
        shareCircle: !share || getComputedStyle(share).width === getComputedStyle(share).height
          && parseFloat(getComputedStyle(share).borderTopLeftRadius) >= parseFloat(getComputedStyle(share).height) / 2,
      };
    });
    assert(shape.overflowX === 'hidden' && shape.overflowY === 'hidden' && shape.cornersClipped && shape.centerVisible,
      `rounded shell must clip child surfaces at every corner: ${JSON.stringify(shape)}`);
    assert(shape.nestedRadii && shape.shareCircle && shape.buttonsFit && shape.backgroundClip === 'padding-box',
      `nested surfaces and controls must fit the rounded shell: ${JSON.stringify(shape)}`);
    return shape;
  };
  const results = [];
  for (const [width, language, theme, paneWidth = width] of [
    [1100, 'en', 'dark'], [390, 'ko', 'light'], [320, 'en', 'dark'], [1100, 'en', 'light', 440],
  ]) {
    await page.setViewportSize({ width, height: 840 });
    await page.goto(`${origin}/?surface=toolbar&language=${language}&theme=${theme}`);
    await page.evaluate(({ paneWidth, theme }) => {
      ReactDOM.unmountComponentAtNode(document.getElementById('toolbar'));
      // Spotify provides a full-size positioned host. Reproduce that scaffold,
      // not the fixture's flex-item sizing, without altering production controls.
      const light = theme === 'light';
      document.getElementById('toolbar').style.cssText = `position:absolute;inset:0;width:${paneWidth}px;height:100%;
        --spice-rgb-card:${light ? '255,255,255' : '32,32,32'};--spice-rgb-text:${light ? '18,18,18' : '255,255,255'};
        --spice-text:${light ? '#121212' : '#fff'};--spice-button-active:${light ? '#187b35' : '#1ed760'};--font-family:system-ui,sans-serif;`;
      document.getElementById('fixture').style.background = light ? '#f4f4f5' : '#101012';
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
    }, { paneWidth, theme });
    const labels = await page.evaluate(() => ({ video: I18n.t('videoSync.title'), share: I18n.t('videoSync.share') }));
    const pill = page.locator('#quick-sync-fixture');
    await checkRoundedShell(pill);
    await pill.getByRole('button', { name: labels.video, exact: true }).click();
    await pill.getByRole('button', { name: /\+0\.1s$/ }).click();
    const stepAnimation = await pill.locator('.lyrics-track-sync-hover-transfer').evaluate(element => getComputedStyle(element).animationName);
    assert(stepAnimation === 'lyrics-track-sync-hover-transfer', 'clipping preserves step feedback');
    const shape = await checkRoundedShell(pill);
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
      const toolbar = document.querySelector('.lyrics-config-button-container.ivl-tb > .ivl-tb-col').getBoundingClientRect();
      const overlapsVertically = rect.top < toolbar.bottom && rect.bottom > toolbar.top;
      return {
        left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        toolbarLeft: toolbar.left, toolbarRight: toolbar.right, overlapsVertically,
        toolbarGap: toolbar.left - rect.right,
        overlapsHorizontally: rect.left < toolbar.right && rect.right > toolbar.left,
      };
    });
    assert(layout.left >= 0 && layout.right <= paneWidth && layout.scrollWidth <= layout.clientWidth + 1,
      `quick controls must fit without clipped buttons: ${JSON.stringify(layout)}`);
    assert(!layout.overlapsVertically || !layout.overlapsHorizontally,
      `quick controls must not overlap the toolbar when their vertical ranges overlap: ${JSON.stringify(layout)}`);
    assert(width > 680 || !layout.overlapsVertically || layout.toolbarGap >= 8,
      `mobile quick controls must leave an 8px gap before the toolbar: ${JSON.stringify(layout)}`);
    const buttons = pill.locator('button'), buttonCount = await buttons.count();
    assert(buttonCount === 10, 'both mode buttons, all seven timing controls and share remain available');
    await buttons.first().focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    for (let index = 0; index < buttonCount; index++) {
      assert(await buttons.nth(index).evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return element === document.activeElement && element.matches(':focus-visible')
          && !element.disabled && element.contains(hit)
          && style.outlineStyle === 'solid' && style.outlineWidth === '2px' && style.outlineOffset === '-2px';
      }), `button ${index} remains usable by pointer and keyboard with an inset focus ring`);
      if (index + 1 < buttonCount) await page.keyboard.press('Tab');
    }
    await page.screenshot({ path: `output/playwright/video-quick-sync-${width}-${paneWidth}-${language}.png` });
    await pill.locator('.lyrics-track-sync-value').click();
    const resetAnimation = await pill.locator('.lyrics-track-sync-value-reset-done').evaluate(element => getComputedStyle(element).animationName);
    assert(resetAnimation === 'lyrics-track-sync-reset-confirm', 'clipping preserves reset confirmation');
    await page.evaluate(() => document.getElementById('fixture').classList.add('motion-reduced'));
    await pill.getByRole('button', { name: /\+0\.1s$/ }).click();
    assert(await pill.locator('.lyrics-track-sync-hover-transfer').evaluate(element => getComputedStyle(element).animationName) === 'none',
      'reduced-motion controls remain respected');
    await page.evaluate(() => document.getElementById('fixture').classList.remove('motion-reduced'));
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
    await checkRoundedShell(pill);
    results.push({ width, paneWidth, language, theme, layout, shape, keyboardButtons: buttonCount, explicitShares: 1, staleVideoGuard: true });
  }
  return results;
}
