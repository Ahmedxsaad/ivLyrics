import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybarHarness } from "./fixtures/playbar_harness.mjs";

test("ivLyrics playbar buttons get native-looking control styling", () => {
	const { created, document } = createPlaybarHarness();
	const headChildren = document.head.children;
	assert.equal(created.length, 2, "expected the lyrics and fullscreen buttons");
	for (const control of created) {
		assert.ok(
			control.element.classList.contains("ivlyrics-playbar-control"),
			`${control.label} button is missing the ivLyrics control class`
		);
	}

	const styles = headChildren.filter((node) => node.id === "ivlyrics-playbar-control-style");
	assert.equal(styles.length, 1, "control style must be injected exactly once");
	const css = styles[0].textContent;
	assert.match(css, /button\.ivlyrics-playbar-control \{[^}]*background: transparent;/);
	assert.match(css, /button\.ivlyrics-playbar-control \{[^}]*border: 0;/);
	assert.match(css, /button\.ivlyrics-playbar-control \{[^}]*appearance: none;/);
	assert.match(css, /button\.ivlyrics-playbar-control\.main-genericButton-buttonActive \{/);
	assert.match(css, /button\.ivlyrics-playbar-control\.main-genericButton-buttonActiveDot::after \{/);
});

test("enabling either replacement later applies shared styling exactly once", () => {
	const h = createPlaybarHarness({ enabled: false });
	assert.equal(h.created.length, 0, "disabled settings must not construct or register buttons");
	h.toggle("fullscreen-button", true);
	h.toggle("playbar-button", true);
	assert.equal(h.created.length, 2);
	for (const control of h.created) {
		assert.ok(control.element.classList.contains("ivlyrics-playbar-control"));
		assert.equal(control.element.isConnected, true);
		assert.equal(control.args[5], false, "registration is controlled by the setting");
	}
	assert.equal(h.document.head.children.filter((node) => node.id === "ivlyrics-playbar-control-style").length, 1);
});
