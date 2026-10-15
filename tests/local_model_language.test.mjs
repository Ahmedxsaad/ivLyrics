import assert from "node:assert/strict";
import test from "node:test";
import { button, createHarness, settle, texts } from "./local_model_harness.mjs";

const openCard = async (options) => {
	const h = createHarness(options);
	h.render();
	await settle();
	return { h, tree: h.render() };
};

test("before any download the card says the translation language is not supported and offers no download", async () => {
	const { h, tree } = await openCard({ cached: [], config: { "translate:target-language": "sv" } });
	assert.ok(texts(tree).includes("The local model cannot translate into Swedish."), JSON.stringify(texts(tree)));
	assert.equal(button(tree, "Download model (1.91GB)").props.disabled, true);
	assert.equal(texts(tree).some((value) => value.startsWith("Not downloaded yet")), false, "nothing invites a download that cannot help");
	await assert.rejects(h.addon.translateLyrics({ trackId: "song", text: "Hej", lang: "sv" }), /cannot translate into Swedish/);
	assert.equal(h.prompts.length, 0);
});

test("with Auto the notice follows the app language, and a downloaded model offers no test", async () => {
	const { tree } = await openCard({ cached: ["high"], config: { "translate:target-language": "auto" }, uiLanguage: "sv" });
	assert.ok(texts(tree).includes("The local model cannot translate into svenska."), JSON.stringify(texts(tree)));
	assert.ok(texts(tree).includes("Downloaded · Loads into memory when it translates"));
	assert.equal(button(tree, "Test translation").props.disabled, true);
	assert.equal(button(tree, "Delete model").props.disabled, false, "the model can still be deleted");
});

test("supported translation languages show no notice and keep Download available", async () => {
	for (const [target, uiLanguage] of [["ko", null], ["zh-TW", null], ["auto", "ja"], [null, null]]) {
		const { tree } = await openCard({ cached: [], config: target ? { "translate:target-language": target } : null, uiLanguage });
		assert.equal(texts(tree).some((value) => value.includes("cannot translate into")), false, String(target));
		assert.equal(button(tree, "Download model").props.disabled, false, String(target));
		assert.ok(texts(tree).some((value) => value.startsWith("Not downloaded yet")), String(target));
	}
});
