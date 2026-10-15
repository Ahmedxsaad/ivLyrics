import assert from "node:assert/strict";
import test from "node:test";
import {
	ENGINE_URL, TIERS, assertNoInternals, button, cacheNameOf, createHarness, failingDownload, settle, sourceOf, texts,
} from "./local_model_harness.mjs";

const errorStatus = (tree) => texts(tree).find((value) => value.startsWith("Error: "));
const NETWORK = "Couldn't connect to the download server. Check your internet connection and try again.";
const STORAGE = "There isn't enough storage space for the model. Free up disk space or choose a lighter quality, then try again.";
const ENGINE = "The translation engine couldn't be loaded. Check your internet connection and try again.";
const LOAD = "The model couldn't be loaded. Delete it and download it again.";

test("download failures explain what to do and never show the address or file name", async () => {
	const failures = [
		[(url) => new Error("Failed to fetch " + url + ": HTTP 429"), "The download server is busy right now (HTTP 429). Wait a few minutes, then try again."],
		[(url) => new Error("Failed to fetch " + url + ": HTTP 503"), "The download server is busy right now (HTTP 503). Wait a few minutes, then try again."],
		[(url) => new Error("Failed to fetch " + url + ": HTTP 403"), "The download server refused the request (HTTP 403). Try again later, or turn off any VPN or proxy you use."],
		[(url) => new Error("Failed to fetch " + url + ": HTTP 404"), "The download server returned an error (HTTP 404). Try again later."],
		[() => new TypeError("Failed to fetch"), NETWORK],
		[() => new TypeError("network error"), NETWORK],
		[() => new DOMException("The operation failed because it would cause the application to exceed its storage quota.", "QuotaExceededError"), STORAGE],
		// The cache's file-writing worker rejects with plain text.
		[() => "QuotaExceededError: Failed to execute 'write' on 'FileSystemSyncAccessHandle'", STORAGE],
	];
	for (const [makeError, expected] of failures) {
		const h = createHarness({ cached: [], download: failingDownload(makeError) });
		h.render();
		await settle();
		button(h.render(), "Download model").props.onClick();
		await settle();
		const status = errorStatus(h.render());
		assert.equal(status, "Error: " + expected);
		assertNoInternals(status);
		assert.equal(h.cache.files.size, 0, expected + ": the partial file is removed");
		assert.ok(h.debug.length > 0, "the raw failure is kept in the debug log");
	}
});

test("an engine that cannot be fetched is reported without the CDN address", async () => {
	const h = createHarness({
		importModule: async () => { throw new TypeError("Failed to fetch dynamically imported module: " + ENGINE_URL); },
	});
	h.render();
	await settle();
	const status = errorStatus(h.render());
	assert.equal(status, "Error: " + ENGINE);
	assertNoInternals(status);
	await assert.rejects(h.addon.translateLyrics({ trackId: "song", text: "君の声", lang: "ko" }), (error) => {
		assert.equal(error.message, ENGINE);
		return true;
	});
	assert.ok(h.debug.some((line) => line.includes(ENGINE_URL)), "the address stays in the debug log");
});

test("a model that cannot be opened is reported without its file name, on screen and to the manager", async () => {
	const fileName = cacheNameOf(TIERS.high.url);
	const h = createHarness({
		load: async () => { throw new Error("Failed to open file " + fileName + "; Hint: the model may be invalid, please refresh it"); },
	});
	await assert.rejects(h.addon.translateLyrics({ trackId: "song", text: "君の声", lang: "ko" }), (error) => {
		assert.equal(error.message, LOAD);
		return true;
	});
	assert.deepEqual(h.loads.map((load) => load.gpuLayers), [99999, 0], "WebGPU first, then the CPU");
	const status = errorStatus(h.render());
	assert.equal(status, "Error: " + LOAD);
	assertNoInternals(status);
	assert.ok(h.debug.some((line) => line.includes(fileName)));
});

test("the card's test translation shows a readable failure", async () => {
	const h = createHarness({
		load: async () => { throw new Error("Failed to open file " + cacheNameOf(TIERS.high.url) + "; Hint: the model may be invalid"); },
	});
	h.render();
	await settle();
	await button(h.render(), "Test translation").props.onClick();
	const tree = h.render();
	assert.ok(texts(tree).includes("✗ " + LOAD), JSON.stringify(texts(tree)));
	await assert.rejects(h.addon.testConnection(), (error) => error.message === LOAD);
	for (const value of texts(tree).filter((line) => line.startsWith("✗") || line.startsWith("Error"))) assertNoInternals(value);
});

test("memory, graphics and runtime failures are explained, and a crashed engine is replaced", async () => {
	const memory = createHarness({ load: async () => { throw new RangeError("WebAssembly.Memory(): could not allocate memory"); } });
	await assert.rejects(memory.addon.translateLyrics({ trackId: "song", text: "君の声", lang: "ko" }),
		{ message: "There isn't enough memory to run the model. Close other apps or choose a lighter quality, then try again." });

	let lost = true;
	const gpu = createHarness({ inference: async () => { if (lost) { lost = false; throw new Error("WebGPU device was lost: Device destroyed"); } } });
	await assert.rejects(gpu.addon.translateLyrics({ trackId: "song", text: "君の声", lang: "ko" }),
		{ message: "The graphics processor (WebGPU) stopped responding. Try again, or set Processor to CPU only." });
	assert.equal(gpu.exits, 1, "the engine with the lost device is released");
	const retried = await gpu.addon.translateLyrics({ trackId: "song", text: "君の声", lang: "ko" });
	assert.deepEqual(Array.from(retried.translation), ["KO:君の声"]);
	assert.equal(gpu.loads.length, 2, "the next request loads a fresh engine");

	// wllama names its runtime errors 'RuntimeError', like a WebAssembly trap.
	const crash = createHarness({
		inference: async () => { throw Object.assign(new Error("memory access out of bounds"), { name: "RuntimeError" }); },
	});
	await assert.rejects(crash.addon.translateLyrics({ trackId: "song", text: "君の声", lang: "ko" }),
		{ message: "Something went wrong with the local model. Try again." });
	assert.equal(crash.exits, 1, "a crashed runtime is released");
});

test("a request over its time budget stops with a localized TimeoutError", async () => {
	const h = createHarness({
		reply: (prompt) => {
			h.advance(60_000);
			return sourceOf(prompt).split("\n").map((line) => "KO:" + line).join("\n");
		},
	});
	await assert.rejects(h.addon.translateLyrics({ trackId: "song", text: Array.from({ length: 24 }, (_, i) => "line" + i).join("\n"), lang: "ko" }), {
		name: "TimeoutError",
		message: "Translation took too long on this device and was stopped. A lighter quality translates faster.",
	});
});
