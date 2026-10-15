import assert from "node:assert/strict";
import test from "node:test";
import {
	TIERS, assertNoInternals, button, cacheNameOf, controlledDownload, createHarness, deferred, failingDownload, settle, texts,
} from "./local_model_harness.mjs";

const startsWith = (tree, prefix) => texts(tree).some((value) => value.startsWith(prefix));

test("a status check that finishes after Download was pressed keeps the progress and Cancel on screen", async () => {
	const engine = deferred();
	const download = controlledDownload();
	const h = createHarness({ cached: [], download: download.download, importGate: engine.promise });

	// The card opens before the engine has loaded, so its first status check is still waiting.
	let tree = h.render();
	assert.ok(texts(tree).includes("…"));
	button(tree, "Download model").props.onClick();
	engine.resolve();
	await settle();

	tree = h.render();
	assert.ok(startsWith(tree, "Downloading 10% · 200 / 1909 MB"), JSON.stringify(texts(tree)));
	assert.ok(button(tree, "Cancel"));
	assert.equal(button(tree, "Download model"), undefined, "no second download is offered while one runs");
	assert.equal(download.calls.length, 1);

	download.calls[0].finish();
	await settle();
	tree = h.render();
	assert.ok(texts(tree).includes("Downloaded · Loads into memory when it translates"));
	assert.ok(button(tree, "Test translation"));
});

test("pressing Download again joins the running download, and Cancel stops it and deletes its partial file", async () => {
	const download = controlledDownload();
	const h = createHarness({ cached: [], download: download.download });
	h.render();
	await settle();
	let tree = h.render();
	const downloadButton = button(tree, "Download model (1.91GB)");
	downloadButton.props.onClick();
	downloadButton.props.onClick(); // a double click lands before the card re-renders
	await settle();
	assert.equal(download.calls.length, 1, "one download, one controller");

	h.advance(1000);
	download.calls[0].progress(0.805);
	tree = h.render();
	assert.ok(startsWith(tree, "Downloading 80% · 1536 / 1909 MB"), JSON.stringify(texts(tree)));
	assert.ok(h.cache.has(TIERS.high.url), "the partial file is written while it downloads");

	button(tree, "Cancel").props.onClick();
	await settle();
	assert.equal(download.calls[0].signal.aborted, true);
	tree = h.render();
	assert.ok(startsWith(tree, "Not downloaded yet"));
	assert.equal(h.cache.files.size, 0, "the cancelled download leaves nothing on disk");

	button(tree, "Download model (1.91GB)").props.onClick();
	await settle();
	assert.equal(download.calls.length, 2, "after cancelling, Download starts a fresh download");
	download.calls[1].finish();
	await settle();
	assert.ok(texts(h.render()).includes("Downloaded · Loads into memory when it translates"));
});

test("a failed download deletes its partial file and says what went wrong without addresses", async () => {
	const h = createHarness({ cached: [], download: failingDownload((url) => new Error("Failed to fetch " + url + ": HTTP 500"), 0.6) });
	h.render();
	await settle();
	button(h.render(), "Download model").props.onClick();
	await settle();
	const tree = h.render();
	const status = texts(tree).find((value) => value.startsWith("Error"));
	assert.equal(status, "Error: The download server returned an error (HTTP 500). Try again later.");
	assertNoInternals(status);
	assert.equal(h.cache.files.size, 0, "the failed download leaves nothing on disk");
	assert.ok(button(tree, "Download model"), "Download can be tried again");
	assert.ok(h.debug.some((line) => line.includes(TIERS.high.url)), "the raw failure stays in the debug log");
});

test("Delete model also clears unfinished downloads of every quality and keeps the other finished ones", async () => {
	// Local High is selected and finished; Medium was cancelled at 80%; Light is finished.
	const h = createHarness({ cached: ["high", "light"], partial: { medium: 0.8 } });
	h.render();
	await settle();
	let tree = h.render();
	assert.ok(texts(tree).includes("Downloaded · Loads into memory when it translates"));
	assert.equal(h.cache.files.size, 3);

	button(tree, "Delete model").props.onClick();
	button(h.render(), "Click again to delete").props.onClick();
	await settle();
	tree = h.render();
	assert.ok(startsWith(tree, "Not downloaded yet"));
	assert.deepEqual([...h.cache.files.keys()], [cacheNameOf(TIERS.light.url)], "only the finished Local Light download stays");
	assert.ok(texts(tree).includes("1.13GB · Downloaded"));
	assert.ok(texts(tree).includes("1.47GB"), "the cleared Medium leftover was never shown as downloaded");
});

test("a partial file left from before is cleared when that quality's model is deleted", async () => {
	const h = createHarness({ cached: ["light"], partial: { high: 0.8 }, settings: { quality: "light" } });
	h.render();
	await settle();
	button(h.render(), "Delete model").props.onClick();
	button(h.render(), "Click again to delete").props.onClick();
	await settle();
	assert.equal(h.cache.files.size, 0, "about 1.5 GB left by a cancelled Local High download is gone");
});
