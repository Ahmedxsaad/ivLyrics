// Run on the loopback first_use_server fixture with playwright-cli run-code --filename.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use the offline first-use fixture");
  page.setDefaultTimeout(5000);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const results = [];
  for (const [language, theme, width, height, pageOnly] of [
    ["en", "dark", 1280, 800, true], ["ru", "light", 1100, 800, false], ["ko", "dark", 390, 840, true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?surface=toolbar&language=${language}&theme=${theme}`);
    const labels = await page.evaluate(pageOnly => {
      ReactDOM.unmountComponentAtNode(document.getElementById("toolbar"));
      // Match Spotify's full-height host; the first-use fixture normally has
      // an auto-height body and no fullscreen portal scaffold.
      document.documentElement.style.height = "100%";
      document.body.style.height = "100vh";
      document.getElementById("toolbar").style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
      document.getElementById("fixture").classList.add("fullscreen-active");
      document.getElementById("fixture").classList.toggle("fullscreen-page-ui", pageOnly);
      window.backgroundSelections = [];
      function Fixture() {
        const [open, setOpen] = React.useState(false);
        const [background, setBackground] = React.useState(null);
        return React.createElement(IvLyricsFloatingToolbar, {
          actions: {
            onToggleMenu: () => setOpen(value => !value), onCloseMenu: () => setOpen(false),
            onSelectBackground: async value => { window.backgroundSelections.push(value); setBackground(value); },
          },
          isFullscreen: true, isMenuOpen: open, modeKey: "synced", hasLyrics: true,
          hasSynced: true, karaokeEnabled: true, trackUri: track.uri, syncTrackUri: track.uri,
          trackTitle: track.name, trackArtist: "Offline artist", currentProvider: "fixture", lyrics,
          backgroundOverride: background, effectiveBackground: background || "album-art",
        });
      }
      ReactDOM.render(React.createElement(Fixture), document.getElementById("toolbar"));
      return {
        background: I18n.t("menu.trackBackground"), provider: I18n.t("menu.selectLyricsProvider"),
        back: getOptionsText("creatorProfile.back", "뒤로"),
      };
    }, pageOnly);
    const toolbar = page.locator(".ivl-tb");
    await toolbar.locator('[data-entry="menu"]').click();
    await toolbar.locator('[data-entry="track"]').click();
    const flyout = toolbar.locator(".ivl-tb-fly");
    const menuItem = name => flyout.getByRole("menuitem").filter({ hasText: name });
    await menuItem(labels.background).click();
    assert(await flyout.isVisible(), "background submenu must survive the same bubbling click");
    assert(await toolbar.locator('[data-entry="menu"]').getAttribute("aria-expanded") === "true", "submenu navigation must not fold fullscreen controls");
    const choices = flyout.getByRole("option");
    assert(await choices.count() > 1, "production background choices are present");
    await choices.nth(1).click();
    assert(await page.evaluate(() => window.backgroundSelections.length) === 1, "the choice still invokes its handler exactly once");
    assert(await flyout.isVisible(), "background selection keeps its settings open");
    await flyout.locator(".ivl-tb-fly-back").click();
    assert(await menuItem(labels.background).count() === 1, "back returns to current-track settings without closing them");
    await flyout.locator(".ivl-tb-fly-body").evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: `output/playwright/fullscreen-track-menu-${language}-${width}-open.png` });
    const items = flyout.getByRole("menuitem");
    await items.first().click();
    assert(await flyout.isVisible(), "provider submenu survives navigation");
    await flyout.locator(".ivl-tb-fly-back").click();
    await page.keyboard.press("Escape");
    assert(await flyout.count() === 0, "Escape closes the panel");
    assert(await toolbar.locator('[data-entry="menu"]').getAttribute("aria-expanded") === "true", "closing the panel preserves the unfolded toolbar");
    await page.mouse.click(24, 24);
    assert(await toolbar.locator('[data-entry="menu"]').getAttribute("aria-expanded") === "false", "a real outside click still folds fullscreen controls");
    await page.screenshot({ path: `output/playwright/fullscreen-track-menu-${language}-${width}.png` });
    results.push({ language, theme, width, height, pageOnly, backgroundPick: true, providerDrill: true, outsideClick: true });
  }
  return results;
}
