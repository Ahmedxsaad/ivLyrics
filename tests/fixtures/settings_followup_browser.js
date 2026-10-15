// Production-source fixtures; run with playwright-cli's run-code --filename.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const results = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://**", route => route.fulfill({ status: 200, contentType: "text/css", body: "/* offline fonts */" }));
  const settle = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(async () => Promise.all([...document.querySelectorAll(".ivlyrics-settings-modal-shell,.settings-dock")]
      .flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {}))));
  };
  const cases = [
    [1440, 900, "en", "dark"], [1280, 720, "ko", "light"],
    [1100, 800, "en", "light"], [1100, 800, "ko", "dark"],
    [640, 800, "en", "dark"], [390, 844, "ko", "light"],
  ];
  const layers = [
    ["original", "original-style"], ["phonetic", "pronunciation-style"],
    ["translation", "translation-style"], ["furigana", "furigana-style"],
  ];
  for (const [width, height, language, theme] of cases) {
    const label = `${width}-${language}-${theme}`;
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:64377/?language=${language}&theme=${theme}&tab=appearance`);
    await page.waitForFunction(() => window.__settingsFixtureState?.ready);
    await settle();
    const links = page.locator(".settings-preview-layer-link");
    if (width > 980) {
      assert(await links.count() === 4, `${label}: preview shortcuts missing`);
      for (const [role, anchor] of layers) {
        const button = page.locator(`.settings-preview-layer-link[data-layer="${role}"]`);
        // Click/keyboard activation must navigate the existing live window,
        // reveal a tabbed layer and never save any preference by itself.
        const before = await page.evaluate(() => JSON.stringify(CONFIG.visual));
        if (role === "translation") { await button.focus(); await page.keyboard.press("Enter"); }
        else await button.click();
        await page.waitForFunction(value => {
          const matrix = document.querySelector(".settings-matrix");
          if (!matrix?.classList.contains("is-tabs")) return true;
          return matrix.querySelector(`[data-setting-key="${value}"][aria-checked="true"]`) !== null;
        }, anchor);
        await settle();
        assert(await page.evaluate(() => JSON.stringify(CONFIG.visual)) === before, `${label}: shortcut changed saved settings`);
      }
      const geometry = await links.evaluateAll(nodes => nodes.map(node => ({
        overflow: node.scrollWidth - node.clientWidth,
        height: node.getBoundingClientRect().height,
      })));
      assert(geometry.every(item => item.height >= 32 && item.overflow <= 1), `${label}: shortcut overflow ${JSON.stringify(geometry)}`);
      await page.screenshot({ path: `output/playwright/ui-followup-${label}-layers.png` });
    } else {
      for (const [, anchor] of layers) {
        await page.evaluate(value => window.settingsFixture.open("appearance", value), anchor);
        await settle();
        await page.waitForFunction(value => document.querySelector(`.settings-matrix [data-setting-key="${value}"][aria-checked="true"]`), anchor);
      }
    }
    await page.evaluate(() => window.settingsFixture.open("performance"));
    await settle();
    assert(await page.locator('.tab-content.active [data-setting-key="blur-gradient-background"]').count() === 0,
      `${label}: Blur Gradient still appears in Performance`);
    await page.evaluate(() => window.settingsFixture.setConfig(Object.fromEntries([
      "karaoke-bounce", "karaoke-line-transition", "karaoke-text-effects", "fade-blur",
      "highlight-mode", "text-shadow-enabled", "video-background",
    ].map(key => [key, true]).concat([["performance-frame-rate", 240], ["blur-gradient-background", false]]))));
    await page.waitForFunction(() => /7\/7/.test(document.querySelector(".settings-load-text small")?.textContent));
    const onBars = await page.locator(".settings-load-bars i.is-on").count();
    assert(onBars === 8, `${label}: maximum cost does not fill all eight bars`);
    await page.evaluate(() => window.settingsFixture.open("appearance", "__background-mode"));
    await settle();
    const blurLabel = await page.evaluate(() => I18n.t("settings.blurGradientBackground.label"));
    assert(await page.getByRole("radio", { name: blurLabel, exact: true }).count() === 1,
      `${label}: background preset was removed from Appearance`);
    assert((await page.evaluate(() => window.__settingsFixtureState.errors)).length === 0, `${label}: fixture runtime error`);
    assert((await page.evaluate(() => window.__settingsFixtureState.blockedNetwork)).length === 0, `${label}: fixture tried live API`);

    await page.goto(`http://127.0.0.1:64378/?surface=toolbar&language=${language}&theme=${theme}`);
    await page.getByRole("toolbar").waitFor();
    await page.keyboard.press("Tab");
    await page.keyboard.press("End");
    const focus = await page.evaluate(() => {
      const button = document.activeElement, css = getComputedStyle(button);
      return { entry: button.dataset.entry, visible: button.matches(":focus-visible"),
        outline: css.outlineWidth, offset: css.outlineOffset, shadow: css.boxShadow };
    });
    assert(focus.entry === "settings" && focus.visible && focus.outline === "2px" && parseFloat(focus.offset) < 0 && focus.shadow === "none",
      `${label}: toolbar focus is not a complete inset ring ${JSON.stringify(focus)}`);
    await page.screenshot({ path: `output/playwright/ui-followup-${label}-toolbar.png` });
    results.push({ label, shortcuts: width > 980 ? 4 : "layer deep links", performance: "7/7", bars: onBars, focus });
  }
  assert(errors.length === 0, `Runtime errors: ${errors.join("; ")}`);
  return results;
}
