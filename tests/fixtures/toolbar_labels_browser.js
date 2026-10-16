// Start first_use_server.mjs with React 18, open /?surface=toolbar, then run:
// playwright-cli --session toolbar-label-item1 run-code --filename tests/fixtures/toolbar_labels_browser.js
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use the loopback first-use fixture");
  // Keep the production stylesheet, using local fallback fonts for remote imports.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({
    status: 200, contentType: "text/css", body: "/* Offline font fallback. */",
  }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const cdp = await page.context().newCDPSession(page);
  const results = [];
  for (const language of ["en", "de", "ko"]) {
    for (const [width, height, zoom] of [[1100, 800, 1], [320, 568, 1], [640, 400, .8], [390, 600, 1.25], [390, 600, 1.5], [320, 568, 2]]) {
      const theme = language === "de" ? "light" : "dark";
      await page.setViewportSize({ width: Math.round(width / zoom), height: Math.round(height / zoom) });
      // Emulate browser zoom: fewer CSS pixels, denser physical pixels. Unlike
      // CSS zoom, this also scales viewport units and fixed-position scroll clips.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: Math.round(width / zoom), height: Math.round(height / zoom),
        deviceScaleFactor: zoom, mobile: false,
      });
      await page.goto(`${origin}/?surface=toolbar&language=${language}&theme=${theme}`);
      await page.waitForSelector(".ivl-tb-col");
      await page.evaluate(language => {
        document.documentElement.lang = language;
        ReactDOM.unmountComponentAtNode(document.getElementById("toolbar"));
        function ToolbarLabelFixture() {
          const [fullscreen, setFullscreen] = React.useState(false);
          const [menuOpen, setMenuOpen] = React.useState(false);
          window.toolbarLabelFixture = { setFullscreen, setMenuOpen };
          document.getElementById("fixture").classList.toggle("fullscreen-active", fullscreen);
          return React.createElement(IvLyricsFloatingToolbar, {
            actions: {
              onToggleFullscreen: () => { setFullscreen(value => !value); setMenuOpen(false); },
              onToggleMenu: () => setMenuOpen(value => !value),
            },
            isFullscreen: fullscreen, isMenuOpen: menuOpen, isMenuClosing: false, modeKey: "synced",
            hasLyrics: true, hasSynced: true, hasUnsynced: true, hasKaraoke: true,
            karaokeEnabled: true, showConvert: true, isLyricsLoading: false, canRegenerate: false,
            trackUri: track.uri, syncTrackUri: track.uri, trackTitle: track.name,
            trackArtist: "Offline artist", currentProvider: "fixture", lyrics, canToggleFullscreen: true,
          });
        }
        ReactDOM.render(React.createElement(ToolbarLabelFixture), document.getElementById("toolbar"));
      }, language);
      const caseName = `${language}-${width}-${Math.round(zoom * 100)}`;
      for (const state of ["normal", "fullscreen-closed", "fullscreen-open"]) {
        if (state === "fullscreen-closed") {
          const fullscreen = page.locator('.ivl-tb-item[data-entry="fullscreen"]');
          await fullscreen.scrollIntoViewIfNeeded();
          await fullscreen.click();
        } else if (state === "fullscreen-open") {
          await page.locator('.ivl-tb-item[data-entry="menu"]').click();
        }
        await page.waitForFunction(expected => {
          const root = document.querySelector(".ivl-tb");
          return root.classList.contains("is-fullscreen") === (expected !== "normal") &&
            root.classList.contains("is-menu-open") === (expected === "fullscreen-open");
        }, state);
        const entries = page.locator(".ivl-tb-item");
        const count = await entries.count();
        assert(count === (state === "normal" ? 7 : state === "fullscreen-open" ? 8 : 1), `${caseName}/${state}: missing entries`);
        const labels = [];
        for (let index = 0; index < count; index++) {
          const entry = entries.nth(index);
          await entry.locator(".ivl-tb-label").scrollIntoViewIfNeeded();
          const geometry = await entry.evaluate(button => {
            const label = button.querySelector(".ivl-tb-label");
            const rect = label.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            const column = button.closest(".ivl-tb-col").getBoundingClientRect();
            const list = button.closest(".ivl-tb-content");
            const clip = (list || button.closest(".ivl-tb-col")).getBoundingClientRect();
            const text = label.firstChild;
            const words = [...label.textContent.matchAll(/\S+/gu)].map(match => {
              const range = document.createRange();
              range.setStart(text, match.index);
              range.setEnd(text, match.index + match[0].length);
              return { text: match[0], rects: [...range.getClientRects()].map(r => ({
                left: r.left, right: r.right, top: r.top, bottom: r.bottom,
              })) };
            });
            const range = document.createRange();
            range.selectNodeContents(label);
            return {
              id: button.dataset.entry, text: label.textContent, name: button.getAttribute("aria-label"),
              columnWidth: column.width, columnLeft: column.left, columnRight: column.right,
              columnTop: column.top, columnBottom: column.bottom, viewportHeight: innerHeight,
              viewport: innerWidth, words, lines: new Set([...range.getClientRects()].map(r => r.top)).size,
              visible: getComputedStyle(label).visibility === "visible" && getComputedStyle(label).display !== "none",
              contained: rect.left >= buttonRect.left - 1 && rect.right <= buttonRect.right + 1 &&
                rect.top >= buttonRect.top - 1 && rect.bottom <= buttonRect.bottom + 1 &&
                rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1,
              textContained: [...range.getClientRects()].every(r => r.left >= rect.left - 1 &&
                r.right <= rect.right + 1 && r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1),
              pressed: button.getAttribute("aria-pressed"),
            };
          });
          const context = `${caseName}/${state}/${geometry.id}`;
          assert(geometry.name && geometry.name.toLocaleLowerCase().includes(geometry.text.toLocaleLowerCase()), `${context}: accessible name lost the visible label`);
          assert(geometry.visible && geometry.contained && geometry.textContained, `${context}: clipped label ${JSON.stringify(geometry)}`);
          assert(geometry.words.every(word => word.rects.length === 1), `${context}: split a word ${JSON.stringify(geometry.words)}`);
          assert(geometry.columnLeft >= 0 && geometry.columnRight <= geometry.viewport + 1, `${context}: column outside viewport`);
          assert(geometry.columnTop >= 0 && geometry.columnBottom <= geometry.viewportHeight + 1, `${context}: column outside viewport vertically`);
          assert(geometry.columnWidth >= 67.5 && geometry.columnWidth <= 110.5, `${context}: lost slim sidebar shape (${geometry.columnWidth}px)`);
          if (geometry.id === "fullscreen") {
            assert(geometry.lines === 1, `${context}: Fullscreen wrapped`);
            assert(geometry.pressed === String(state === "fullscreen-open"), `${context}: fullscreen state lost`);
          }
          labels.push({ id: geometry.id, text: geometry.text, lines: geometry.lines });
        }
        const keyboardTarget = state === "fullscreen-closed" ? "menu" : "fullscreen";
        await page.keyboard.press("Tab");
        await page.locator(`.ivl-tb-item[data-entry="${keyboardTarget}"]`).focus();
        const focus = await page.evaluate(() => {
          const button = document.activeElement;
          const style = getComputedStyle(button);
          return { visible: button.matches(".ivl-tb-item:focus-visible"), width: parseFloat(style.outlineWidth),
            offset: parseFloat(style.outlineOffset), color: style.outlineColor };
        });
        assert(focus.visible && focus.width > 0 && focus.offset < 0 && focus.color !== "rgba(0, 0, 0, 0)", `${caseName}/${state}: missing inset keyboard focus ring ${JSON.stringify(focus)}`);
        results.push({ language, width, height, zoom, state, labels });
        if (zoom === 1 || (zoom === 2 && state === "fullscreen-open")) {
          await page.locator(".ivl-tb-content").evaluateAll(lists => lists.forEach(list => { list.scrollTop = 0; }));
          await page.screenshot({ path: `output/playwright/toolbar-label-item1-${caseName}-${state}.png` });
        }
      }
    }
  }
  await page.evaluate(value => { window.toolbarLabelResults = value; }, results);
  await cdp.detach();
  return { cases: results.length, entriesChecked: results.reduce((sum, result) => sum + result.labels.length, 0),
    languages: ["en", "de", "ko"], widths: [1100, 640, 390, 320], emulatedZoom: [.8, 1, 1.25, 1.5, 2] };
}
