import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../SettingsStyles.js", import.meta.url), "utf8");
const css = vm.runInNewContext(styleSource + "\nSETTINGS_MODAL_CSS;", { APP_NAME: "ivLyrics" });
const toolbarCss = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};

test("each preview layer is a named native button leading to its existing Appearance controls", () => {
  const calls = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const context = vm.createContext({
    react, SettingsUiIcon: "SettingsUiIcon",
    getSettingsText: (_key, fallback) => fallback,
    LYRICS_TYPOGRAPHY_SECTIONS: [
      { role: "original", section: "original-style" },
      { role: "phonetic", section: "pronunciation-style" },
      { role: "translation", section: "translation-style" },
    ],
  });
  vm.runInContext(slice("const getSettingsLayerLegend =", "const renderSettingsPreviewLine =")
    + "\nglobalThis.Links = SettingsPreviewLayerLinks;", context);
  const tree = context.Links({ onNavigate: (...args) => calls.push(args) });
  assert.equal(tree.props.className, "settings-preview-legend");
  const names = ["Original", "Pronunciation", "Translation", "Furigana"];
  tree.children.forEach((button, index) => {
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.equal(button.children[1].children[0], names[index]);
    assert.equal(button.children[0].props["aria-hidden"], "true");
    assert.equal(button.children[2].props.name, "right");
    button.props.onClick();
  });
  assert.deepEqual(calls, [
    ["appearance", "original-style"], ["appearance", "pronunciation-style"],
    ["appearance", "translation-style"], ["appearance", "furigana-style"],
  ]);
  assert.match(source, /onNavigate: navigateToDestination/);
});

test("layer links reserve space for long labels and keep a visible inner keyboard outline", () => {
  assert.match(css, /\.settings-preview-legend \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.settings-preview-layer-link > span \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.settings-preview-layer-link:focus-visible \{[^}]*outline: 2px[^}]*outline-offset: -2px/);
});

test("toolbar focus ring stays inside entries clipped by the scroll container", () => {
  assert.match(toolbarCss, /\.ivl-tb-item:focus-visible \{\s*outline: 2px solid var\(--ivl-tb-accent-text\);\s*outline-offset: -3px;\s*box-shadow: none;/);
  assert.match(toolbarCss, /\.ivl-tb-content \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/);
  assert.doesNotMatch(toolbarCss, /\.ivl-tb-item:focus-visible \{\s*outline: none/);
});

test("navigation reveals narrow layer tabs even when their anchor is already rendered", () => {
  const navigation = slice("const tryScroll = () => {", "const scrollTop = pendingScrollTopRef.current;");
  assert.match(navigation, /if \(attempt === 1\) \{[\s\S]*settings-reveal[\s\S]*requestAnimationFrame\(tryScroll\);\s*return;/);
  assert.doesNotMatch(navigation, /if \(!target && attempt === 1\)/);
  assert.match(navigation, /behavior: attempt <= 2 \? "smooth" : "auto"/);
});
