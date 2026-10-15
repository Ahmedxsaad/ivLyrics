import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Regression: while prefetching the next song, the video lookup borrowed the
// *playing* song's ISRC/title/artists and then remembered the ISRC echoed by
// the server, so the next song (Goosebumps) got the previous song's video.

const serviceSource = readFileSync(new URL("../LyricsService.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const videoSource = readFileSync(new URL("../VideoBackground.js", import.meta.url), "utf8");
const matchSource = readFileSync(new URL("../VideoMatch.js", import.meta.url), "utf8");
// Top-level request/match helpers of VideoBackground.js (before the component).
const videoHelpers = videoSource.slice(0, videoSource.indexOf("const disableYouTubeCaptions"));

const PLAYING_URI = "spotify:track:AAAAAAAAAAAAAAAAAAAAAA";
const NEXT_URI = "spotify:track:BBBBBBBBBBBBBBBBBBBBBB";
const NEXT_ID = "BBBBBBBBBBBBBBBBBBBBBB";
const PLAYING_ISRC = "AEA0D2400001";
const NEXT_ISRC = "USUM72300001";

const slice = (source, startText, endText) => {
    const start = source.indexOf(startText);
    assert.ok(start >= 0, `missing anchor: ${startText}`);
    const end = source.indexOf(endText, start + startText.length);
    assert.ok(end > start, `missing anchor: ${endText}`);
    return source.slice(start, end);
};

const playingItem = () => ({
    uri: PLAYING_URI,
    name: "Arabic Song",
    artists: [{ name: "Arabic Artist" }],
    album: { name: "Arabic Album" },
    metadata: { isrc: PLAYING_ISRC },
});

function loadGetTrackIsrc() {
    const code = [
        slice(serviceSource, "const TrackIdentity = (() => {", "const MODULE_KEY"),
        slice(serviceSource, "function normalizeSyncDataIsrc(", "function spotifyTrackIdToGid("),
        slice(serviceSource, "function getTrackIdFromInput(", "async function resolveTrackIsrc("),
        "globalThis.__getTrackIsrc = getTrackIsrc;",
    ].join("\n");
    const context = vm.createContext({
        window: {},
        Spicetify: { Player: { data: { item: playingItem() } } },
    });
    vm.runInContext(code, context);
    return context.__getTrackIsrc;
}

test("ISRC lookup for another track ignores the playing track's ISRC", () => {
    const getTrackIsrc = loadGetTrackIsrc();
    assert.equal(getTrackIsrc(NEXT_ID, { trackId: NEXT_ID }), "");
});

test("ISRC lookup for the playing track still uses the player's ISRC", () => {
    const getTrackIsrc = loadGetTrackIsrc();
    assert.equal(getTrackIsrc("AAAAAAAAAAAAAAAAAAAAAA", {}), PLAYING_ISRC);
    assert.equal(getTrackIsrc(null, {}), PLAYING_ISRC);
});

function loadPrefetcher({ responseIsrc }) {
    const method = slice(
        indexSource,
        "async _prefetchVideoBackground(uri, trackInfo = null) {",
        "  /**\n   * 헬퍼 프로그램을 통한"
    );
    const calls = { resolveMetadata: null, remembered: [], urls: [], headers: [] };
    const context = vm.createContext({
        CONFIG: { visual: {} },
        Utils: {
            currentVersion: "6.6.30",
            extractTrackId: uri => uri.split(":")[2] || null,
            getUserHash: () => "user-hash",
        },
        // The next track is rarely in Spotify's local metadata cache.
        SpotifyDataHelper: { extractSpotifyData: () => null },
        Spicetify: { Player: { data: { item: playingItem() } } },
        window: {
            SyncDataService: {
                resolveTrackIsrc: async (_trackId, metadata) => {
                    calls.resolveMetadata = metadata;
                    return NEXT_ISRC;
                },
                normalizeSyncDataIsrc: value => (typeof value === "string" ? value : ""),
                rememberTrackIsrc: (trackId, isrc) => calls.remembered.push([trackId, isrc]),
            },
        },
        fetch: async (url, init = {}) => {
            calls.urls.push(new URL(url));
            calls.headers.push(init.headers || {});
            return {
                headers: { get: () => null },
                json: async () => ({
                    success: true,
                    data: { youtubeVideoId: "video-id", isrc: responseIsrc },
                }),
            };
        },
        ivLyricsDebug: () => { },
        console: { warn: () => { }, log: () => { } },
        URL,
        Date,
    });
    const prefetcher = vm.runInContext(
        `${videoHelpers}\n({ _prefetchCache: new Map(), _inflightRequests: new Map(), _prefetchVideoWithHelper() { }, ${method} })`,
        context
    );
    return { prefetcher, calls };
}

const nextTrackInfo = {
    uri: NEXT_URI,
    title: "Goosebumps",
    artist: "Travis Scott, Kendrick Lamar",
    album: "Birds in the Trap Sing McKnight",
};

test("video prefetch describes the next track with its own metadata", async () => {
    const { prefetcher, calls } = loadPrefetcher({ responseIsrc: NEXT_ISRC });
    await prefetcher._prefetchVideoBackground(NEXT_URI, nextTrackInfo);

    assert.equal(calls.resolveMetadata.isrc, "", "the playing track's ISRC must not be offered");
    assert.equal(calls.resolveMetadata.trackName, "Goosebumps");
    assert.equal(calls.urls.length, 1);
    const params = calls.urls[0].searchParams;
    assert.equal(params.get("isrc"), NEXT_ISRC);
    assert.equal(params.get("trackId"), NEXT_ID);
    assert.equal(params.get("trackName"), "Goosebumps");
    assert.equal(params.get("trackArtists"), "Travis Scott, Kendrick Lamar");
    assert.equal(params.get("album"), "Birds in the Trap Sing McKnight");
});

test("video prefetch sends the client parameters and headers the server requires", async () => {
    // Without them the server returns a placeholder video and the prefetch
    // always came back empty.
    const { prefetcher, calls } = loadPrefetcher({ responseIsrc: NEXT_ISRC });
    await prefetcher._prefetchVideoBackground(NEXT_URI, nextTrackInfo);

    const params = calls.urls[0].searchParams;
    assert.equal(params.get("client"), "ivLyrics");
    assert.equal(params.get("requestVersion"), "2");
    assert.equal(params.get("useCommunity"), "true");
    assert.equal(params.get("clientVersion"), "6.6.30");
    assert.equal(calls.headers[0]["X-ivLyrics-Client"], "ivLyrics");
    assert.equal(calls.headers[0]["X-ivLyrics-Request-Version"], "2");
    assert.equal(calls.headers[0]["X-ivLyrics-Client-Version"], "6.6.30");
    assert.deepEqual([...prefetcher._prefetchCache.keys()], [`prefetch:video:${NEXT_ISRC}`]);
});

test("a mismatched ISRC in a video response is never remembered or cached", async () => {
    const { prefetcher, calls } = loadPrefetcher({ responseIsrc: PLAYING_ISRC });
    await prefetcher._prefetchVideoBackground(NEXT_URI, nextTrackInfo);

    assert.deepEqual(calls.remembered, []);
    assert.deepEqual([...prefetcher._prefetchCache.keys()], [`prefetch:video:${NEXT_ISRC}`]);
});

async function runVideoResponse(data) {
    // The success branch inside VideoBackground's loadVideoInfo effect.
    const block = slice(videoSource, "// 로컬 캐시에 저장", "setVideoInfo(picked.video);");
    const calls = { writes: [], shown: [], errors: [] };
    const context = vm.createContext({
        window: { SyncDataService: { normalizeSyncDataIsrc: value => value || "" } },
        Spicetify: { Player: { data: { item: playingItem() } } },
        LyricsCache: { setYouTube: async (isrc, info) => { calls.writes.push([isrc, info.youtubeVideoId]); } },
        I18n: { t: key => key },
        console: { warn: () => { } },
        setVideoInfo: info => calls.shown.push(info?.youtubeVideoId ?? null),
        showVideoBackgroundError: message => calls.errors.push(message),
        videoSourceRef: { current: "" },
        rejectedVideoIds: null,
        trackFacts: { title: "goosebumps", artists: ["Travis Scott"], durationMs: 243_000, isrc: NEXT_ISRC },
        trackIsrc: NEXT_ISRC,
        isMounted: true,
        data,
    });
    await vm.runInContext(`${matchSource}\n${videoHelpers}\n(async function () {\n${block}setVideoInfo(picked.video);\n})();`, context);
    return calls;
}

const arabicPick = { youtubeVideoId: "arabicVideo", youtubeTitle: "عمرو دياب - تملي معاك", isrc: PLAYING_ISRC, isAutoGenerated: true };

test("a server pick of another song is replaced by the matching community video", async () => {
    const calls = await runVideoResponse({
        success: true,
        data: arabicPick,
        communityVideos: [{
            id: 5, youtubeVideoId: "goosebumps1", youtubeTitle: "Travis Scott - goosebumps (Official Video)",
            isrc: NEXT_ISRC, submitterId: "system", isAutoGenerated: true, startTime: 12, skipSegments: [],
        }],
    });
    assert.deepEqual(calls.shown, ["goosebumps1"]);
    assert.deepEqual(calls.writes, [[NEXT_ISRC, "goosebumps1"]], "cached under the requested ISRC");
});

test("without a matching candidate the artwork stays and the user is told", async () => {
    const calls = await runVideoResponse({ success: true, data: arabicPick, communityVideos: [] });
    assert.deepEqual(calls.shown, [null]);
    assert.deepEqual(calls.writes, []);
    assert.deepEqual(calls.errors, ["videoBackground.noMatch"]);
});

test("video background caches a matching response under the ISRC it requested", async () => {
    const calls = await runVideoResponse({
        success: true,
        data: { youtubeVideoId: "video-id", youtubeTitle: "goosebumps", isrc: "", isAutoGenerated: true },
    });
    assert.deepEqual(calls.writes, [[NEXT_ISRC, "video-id"]]);
    assert.deepEqual(calls.shown, ["video-id"]);
});
