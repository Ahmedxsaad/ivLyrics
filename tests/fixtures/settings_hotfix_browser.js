// playwright-cli --session ui-hotfix run-code --filename tests/fixtures/settings_hotfix_browser.js
// Start settings_hotfix_server.mjs on loopback port 64377 first.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const results = [];
  const cases = [
    [1440, 900, "en", "dark"], [1280, 720, "en", "light"],
    [960, 720, "ko", "dark"], [640, 800, "ko", "light"],
    [390, 844, "en", "dark"], [390, 844, "ko", "light"],
  ];
  const open = async tab => {
    await page.evaluate(value => window.settingsFixture.open(value), tab);
    await page.waitForFunction(value => document.querySelector(".tab-content.active")?.dataset.tabId === value, tab);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(async () => Promise.all(
      [...document.querySelectorAll(".ivlyrics-settings-modal-shell,.settings-dock")]
        .flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {}))
    ));
  };
  const geometry = async () => page.evaluate(() => {
    const root = document.getElementById("ivLyrics-config-container");
    const content = root.querySelector(".settings-content");
    const top = root.querySelector(".settings-topbar");
    return { contentOverflow: content.scrollWidth - content.clientWidth, topOverflow: top.scrollWidth - top.clientWidth,
      errors: window.__settingsFixtureState.errors, network: window.__settingsFixtureState.blockedNetwork };
  });
  for (const [width, height, language, theme] of cases) {
    const label = `${width}-${language}-${theme}`;
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:64377/?language=${language}&theme=${theme}&tab=general`);
    await page.waitForFunction(() => window.__settingsFixtureState?.ready);
    await page.evaluate(async () => Promise.all(
      [...document.querySelectorAll(".ivlyrics-settings-modal-shell")]
        .flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {}))
    ));
    const header = await page.evaluate(() => ({
      changed: document.querySelector(".settings-changed-chip").getBoundingClientRect().height,
      theme: document.querySelector(".settings-theme-control").getBoundingClientRect().height,
      tocHidden: document.querySelector(".settings-toc")?.hidden ?? true,
    }));
    assert(header.changed === header.theme, `${label}: changed/theme heights differ`);
    if (width >= 960) assert(header.tocHidden, `${label}: short General page has redundant navigation`);
    const root = page.locator("#ivLyrics-config-container");
    const target = root.locator('[data-setting-key="translate:target-language"] select');
    const beforeUrl = page.url();
    await target.selectOption(language === "ko" ? "en" : "ko");
    assert(page.url() === beforeUrl, `${label}: target-language change navigated`);
    assert(await root.count() === 1, `${label}: target-language change closed Settings`);
    const targetCalls = await page.evaluate(() => window.__settingsFixtureState.calls.filter(call => call.type === "reloadLyrics").length);
    assert(targetCalls === 1, `${label}: target-language change did not refresh current lyrics once`);

    await open("appearance");
    const appearance = await geometry();
    assert(appearance.contentOverflow <= 1, `${label}: appearance content overflows ${appearance.contentOverflow}px`);
    const colors = await page.locator(".multi-vocal-color-row").evaluateAll(rows => rows.map(row => ({
      height: row.getBoundingClientRect().height,
      width: row.getBoundingClientRect().width,
      overflow: row.scrollWidth - row.clientWidth,
    })));
    assert(colors.length === 15 && colors.every(row => Math.abs(row.height - 40) < .1 && row.overflow <= 1), `${label}: speaker colors misaligned ${JSON.stringify(colors)}`);
    const lineCount = await page.locator(".settings-linewin-line").count();
    assert(lineCount === 11, `${label}: 0/10 line preview does not contain 11 bars`);
    const overlaps = await page.locator(".settings-matrix-cell.is-changed").evaluateAll(cells => cells.flatMap(cell => {
      const control = cell.querySelector(".settings-select,.settings-scrub");
      const reset = cell.querySelector(".settings-reset-btn");
      if (!control || !reset) return [];
      const c = control.getBoundingClientRect(), r = reset.getBoundingClientRect();
      return c.right > r.left ? [cell.dataset.settingKey] : [];
    }));
    assert(overlaps.length === 0, `${label}: font change/reset overlaps ${overlaps.join(",")}`);
    assert(await root.locator(".settings-changed-dot").count() === 0, `${label}: obsolete change dots remain`);
    const changedColors = await page.evaluate(() => ({
      menu: getComputedStyle(document.querySelector(".settings-rail-item.is-modified .settings-rail-label")).color,
      field: (() => {
        const font = document.querySelector('[data-setting-key="original-font-family"]');
        return getComputedStyle(font.querySelector(font.classList.contains("setting-row") ? ".setting-name" : "select,input")).color;
      })(),
      normal: getComputedStyle(document.getElementById("ivLyrics-config-container")).color,
    }));
    assert(changedColors.menu !== changedColors.normal && changedColors.field !== changedColors.normal, `${label}: changed menu/field not highlighted`);
    const rangeEdges = await page.locator(".setting-row.is-inline .settings-range").evaluateAll(ranges => ranges.flatMap(range => {
      const row = range.closest(".setting-row"), style = getComputedStyle(row);
      const edge = row.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth || 0);
      const diff = Math.abs(edge - range.getBoundingClientRect().right);
      return diff > 1 ? [{ key: row.dataset.settingKey, diff }] : [];
    }));
    assert(rangeEdges.length === 0, `${label}: ranges are inset ${JSON.stringify(rangeEdges)}`);
    await page.locator(".multi-vocal-color-settings").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/ui-hotfix/${label}-colors.png` });
    const font = root.locator('[data-setting-key="original-font-family"]');
    await font.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/ui-hotfix/${label}-fonts.png` });

    if (width === 1440) {
      const scrub = root.locator('[data-setting-key="original-font-size"] .settings-scrub').first();
      await scrub.scrollIntoViewIfNeeded();
      const box = await scrub.boundingBox();
      const savesBefore = await page.evaluate(() => window.__settingsFixtureState.calls.length);
      await page.mouse.move(box.x + 12, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 62, box.y + box.height / 2, { steps: 12 });
      const savesDuring = await page.evaluate(() => window.__settingsFixtureState.calls.length);
      assert(savesBefore === savesDuring, "font scrub performs global saves during pointer motion");
      await page.mouse.up();
      assert(await page.evaluate(() => window.__settingsFixtureState.calls.length) > savesDuring, "font scrub did not save on release");

      const range = root.locator('.settings-range input[type="range"]').first();
      await range.evaluate(input => input.scrollIntoView({ block: "center" }));
      const track = await range.boundingBox();
      const fraction = await range.evaluate(input => (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)));
      const rangeSavesBefore = await page.evaluate(() => window.__settingsFixtureState.calls.length);
      await page.mouse.move(track.x + 8 + fraction * (track.width - 16), track.y + track.height / 2);
      await page.mouse.down();
      await page.mouse.move(track.x + track.width * .8, track.y + track.height / 2, { steps: 12 });
      const rangeSavesDuring = await page.evaluate(() => window.__settingsFixtureState.calls.length);
      assert(rangeSavesBefore === rangeSavesDuring, "range slider performs global saves during pointer motion");
      await page.mouse.up();
      assert(await page.evaluate(() => window.__settingsFixtureState.calls.length) > rangeSavesDuring, "range slider did not save on release");
    }

    await open("fullscreen");
    await page.locator(".settings-view-switch [role=radio]").last().click();
    await page.waitForSelector(".fullscreen-presentation-grid");
    const cards = root.locator(".fullscreen-presentation-grid [role=radio]");
    const selected = root.locator('.fullscreen-presentation-grid [aria-checked="true"]');
    await selected.focus();
    await page.keyboard.press("Home");
    assert(await cards.first().getAttribute("aria-checked") === "true", `${label}: LP cards Home key fails`);
    const cardStyles = await cards.evaluateAll(items => items.map(item => ({
      display: getComputedStyle(item).display, radius: getComputedStyle(item).borderRadius,
      title: getComputedStyle(item.querySelector("strong")).fontSize,
      description: getComputedStyle(item.querySelector(".settings-choice-content span")).fontSize,
    })));
    assert(cardStyles.every(card => card.display === "flex" && card.radius === "8px" && card.title === "13px" && card.description === "12px"), `${label}: LP card typography/styles missing`);
    await cards.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/ui-hotfix/${label}-vinyl.png` });
    const vinyl = await geometry();
    assert(vinyl.contentOverflow <= 1, `${label}: LP content overflows`);

    await open("ai-providers");
    await root.locator(".settings-connection-card button").first().click();
    const key = root.locator("#ivlyrics-deepl-api-key");
    await key.scrollIntoViewIfNeeded();
    await key.fill("offline-fixture-not-a-real-key");
    const keyFits = await key.evaluate(input => {
      const i = input.getBoundingClientRect(), c = input.closest(".settings-connection-card").getBoundingClientRect();
      return i.left > c.left && i.right < c.right && i.height >= 32;
    });
    assert(keyFits, `${label}: DeepL field clips its card`);
    await page.screenshot({ path: `output/playwright/ui-hotfix/${label}-deepl.png` });
    assert((await geometry()).contentOverflow <= 1, `${label}: AI provider content overflows`);

    await open("debug");
    const debug = await geometry();
    assert(debug.contentOverflow <= 1 && debug.topOverflow <= 1, `${label}: Debug or topbar overflows`);
    assert(debug.errors.length === 0 && debug.network.length === 0, `${label}: runtime error or external operation`);
    const logText = await root.locator(".debug-api-list").innerText();
    assert(!logText.includes("Invalid Date"), `${label}: invalid log date`);
    const logButton = root.locator(".debug-api-header").first();
    await logButton.click();
    assert(await logButton.getAttribute("aria-expanded") === "true", `${label}: log expansion fails`);
    await page.keyboard.press("Enter");
    assert(await logButton.getAttribute("aria-expanded") === "false", `${label}: log keyboard collapse fails`);
    await page.screenshot({ path: `output/playwright/ui-hotfix/${label}-logs.png` });
    if (width === 1280) {
      await open("appearance");
      const family = root.locator('[data-setting-key="original-font-family"]');
      await family.scrollIntoViewIfNeeded();
      await family.hover();
      await family.locator(".settings-reset-btn").click();
      await page.waitForFunction(() => !document.querySelector('[data-setting-key="original-font-family"]').classList.contains("is-changed"));
      assert(await family.locator("select").inputValue() === "Pretendard Variable", "font reset does not restore its default");
    }
    results.push({ label, speakerRows: colors.length, lineBars: lineCount, overlapCount: overlaps.length,
      rangeInsetCount: rangeEdges.length, errors: debug.errors.length, blockedNetwork: debug.network.length });
  }
  return results;
}
