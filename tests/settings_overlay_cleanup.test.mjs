import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createDomHarness } from "./fixtures/playbar_harness.mjs";

const source = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
const start = source.indexOf("function openConfig(options = {}) {"), end = source.indexOf("\nfunction queueReloadIntoIvLyrics(", start);
assert.ok(start >= 0 && end > start);
const openConfigSource = source.slice(start, end);

for (const immediate of [false, true]) {
  for (const failUnmount of [false, true]) {
    test(`settings close cleans overlay, listener and visibility (immediate=${immediate}, unmount throws=${failUnmount})`, () => {
      const h = createDomHarness();
      const { document, window, context } = h;
      const profile = document.createElement("button"); document.body.appendChild(profile); profile.focus();
      const failure = new Error("fixture React unmount failure");
      let unmounts = 0;
      const visibility = [];
      window.addEventListener("ivLyrics:settings-visibility", (event) => visibility.push(event.detail.open));
      context.getEffectiveReducedMotionPreference = () => false;
      context.getSettingsMotionDurationMs = () => 140;
      context.react = { createElement: () => ({}) }; context.ConfigModal = function() {};
      context.reactDOM = { render() {}, unmountComponentAtNode() { unmounts++; if (failUnmount) throw failure; } };
      vm.runInContext(openConfigSource, context);
      context.openConfig(); h.advance(16);
      assert.ok(document.getElementById("ivLyrics-settings-overlay"));
      assert.equal(window.listeners.get("keydown").length, 1);
      assert.ok(document.documentElement.classList.contains("ivlyrics-settings-open"));
      const close = window.ivLyricsCloseConfig;
      const finish = () => { close(immediate); if (!immediate) h.advance(140); };
      if (failUnmount) assert.throws(finish, (error) => error === failure); else finish();
      assert.equal(document.getElementById("ivLyrics-settings-overlay"), null);
      assert.equal(document.body.classList.contains("ivlyrics-settings-open"), false);
      assert.equal(document.documentElement.classList.contains("ivlyrics-settings-open"), false);
      assert.equal(window.listeners.get("keydown").length, 0);
      assert.equal(window.ivLyricsCloseConfig, null);
      assert.equal(document.activeElement, profile);
      assert.deepEqual(visibility, [true, false]);
      close(true); assert.equal(unmounts, 1, "old close callback remains idempotent");
      context.openConfig(); h.advance(16);
      assert.ok(document.getElementById("ivLyrics-settings-overlay"), "failed React cleanup must not block reopening");
      assert.equal(window.listeners.get("keydown").length, 1);
      context.reactDOM.unmountComponentAtNode = () => {}; window.ivLyricsCloseConfig(true);
      assert.equal(document.getElementById("ivLyrics-settings-overlay"), null);
    });
  }
}
