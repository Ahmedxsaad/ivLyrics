// Run against sync_creator_preview_server.mjs via playwright-cli run-code --filename.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use the offline fixture');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.fulfill({status:200,contentType:'text/css',body:''}));
  const results=[];
  for (const width of [1000,390]) {
    await page.setViewportSize({width,height:1000});
    await page.goto(origin);
    await page.locator('[data-locale="ja"] .lyrics-karaoke-char-reading').first().waitFor();
    for (const position of [1200,9000,1200]) {
      await page.evaluate(position=>window.paintPreview(position),position);
      const rows=await page.evaluate(()=>[...document.querySelectorAll('.preview-row')].map(row=>({
        locale:row.dataset.locale,
        glyphs:[...row.querySelectorAll('.lyrics-karaoke-glyph-fill')].map(node=>node.textContent),
        charReadings:row.querySelectorAll('.lyrics-karaoke-char-reading').length,
        runReadings:[...row.querySelectorAll('.lyrics-karaoke-run-reading')].map(node=>({text:node.textContent,width:node.getBoundingClientRect().width,color:getComputedStyle(node).webkitTextFillColor})),
        ruby:row.querySelectorAll('ruby rt').length,
      })));
      for (const row of rows) {
        if(row.locale==='ja'){assert(row.charReadings===4&&row.ruby===1,'Japanese glyph readings and ruby remain visible');continue;}
        assert(row.charReadings===0,'Shaped scripts retain whole text nodes');
        assert(row.runReadings.length===2,`${row.locale} has a reading for each contiguous word`);
        assert(row.runReadings.every(reading=>reading.width>0&&!/rgba\([^)]*,\s*0\)/.test(reading.color)),`${row.locale} readings stay painted after completion`);
      }
      const centered=await page.locator('#interlude').evaluate(node=>getComputedStyle(node).justifyContent==='center');
      assert(centered,'Interlude row centers inside preview');
      results.push({width,position,rows:rows.length});
    }
    await page.screenshot({path:`output/playwright/pr126-preview-${width}.png`,fullPage:true});
  }
  return results;
}
