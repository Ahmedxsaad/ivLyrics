// Run against sync_creator_style_selection_server.mjs with playwright-cli run-code --filename.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use the offline selection fixture');
  const results = [];
  for (const [width,language] of [[1100,'en'],[390,'ko']]) {
    await page.setViewportSize({width,height:900});
    await page.goto(`${origin}/?language=${language}`);
    const panel = page.locator('.sync-creator-range-style-editor');
    await panel.waitFor();
    const labels = await page.evaluate(() => ({glow:I18n.t('syncCreator.kindGlow'),clear:I18n.t('syncCreator.rangeStyleClear')}));
    const glow = page.getByRole('button',{name:labels.glow,exact:true});
    assert(await glow.isDisabled(), 'no style can apply without a selection');
    const times = await page.evaluate(() => JSON.stringify(window.selectionFixtureState.syncData.lines[0].chars));
    const drag = async (start,end) => {
      const a=await page.locator(`#lyric-row [data-char-index="${start}"]`).boundingBox();
      const b=await page.locator(`#lyric-row [data-char-index="${end}"]`).boundingBox();
      assert(a&&b, 'source character cells are rendered');
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
      await page.mouse.down({button:'right'});
      await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});
      await page.mouse.up({button:'right'});
    };
    await drag(1,3);
    assert((await panel.textContent()).includes('BCD'), 'main-row selection appears in the style panel');
    await glow.click();
    await page.getByRole('button',{name:'MALE2',exact:true}).click();
    const first = await page.evaluate(() => window.selectionFixtureState.syncData.lines[0].styleRanges);
    assert(first.length===1&&first[0].start===11&&first[0].end===13&&first[0].kind==='glow'&&first[0].speaker==='MALE 2','effect and color compose on exactly the selected cells');
    assert(await page.locator('#lyric-row .ivlyrics-karaoke-range-style.glow').count()===3,'production character renderer paints the selected effect');
    await page.screenshot({path:`output/playwright/pr126-style-selection-${width}-${language}.png`,fullPage:true});
    await page.getByRole('button',{name:labels.clear,exact:true}).click();
    await drag(0,5);
    await glow.click();
    const full = await page.evaluate(() => window.selectionFixtureState.syncData.lines[0].styleRanges);
    assert(full.length===1&&full[0].start===10&&full[0].end===15,'full-row styling remains selectable');
    await page.getByRole('button',{name:labels.clear,exact:true}).click();
    await page.locator('[data-fixture-target="part"]').click();
    await page.waitForFunction(() => window.selectionFixtureState.target==='part'&&window.selectionFixtureState.range===null);
    assert(await glow.isDisabled(),'switching vocal targets clears the previous selection');
    await drag(0,2);
    assert((await panel.textContent()).includes('CDF'),'partial vocal displays its own selected text');
    await glow.click();
    const split = await page.evaluate(() => window.selectionFixtureState.syncData.lines[0].styleRanges);
    assert(split.length===2&&split[0].start===12&&split[0].end===13&&split[1].start===15&&split[1].end===15,'noncontiguous vocal does not style the missing source characters');
    assert(await page.evaluate(() => JSON.stringify(window.selectionFixtureState.syncData.lines[0].chars))===times,'style changes never alter saved timing');
    await page.locator('[data-fixture-mode]').click();
    await page.waitForFunction(() => window.selectionFixtureState.mode==='record');
    assert(await panel.count()===0,'record mode hides partial effects');
    await page.locator('[data-fixture-mode]').click();
    await page.waitForFunction(() => window.selectionFixtureState.mode==='idle'&&window.selectionFixtureState.range===null);
    assert(await glow.isDisabled(),'returning from recording cannot reuse an old style selection');
    assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),'the narrow layout has no page-wide overflow');
    results.push({width,language,selected:'BCD',noncontiguous:'CDF',timingUnchanged:true});
  }
  return results;
}
