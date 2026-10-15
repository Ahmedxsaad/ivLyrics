import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../VideoBackground.js", import.meta.url), "utf8");
const helperBoundary = source.indexOf("const disableYouTubeCaptions");
assert.ok(helperBoundary > 0, "VideoBackground sync helpers must remain before the component helpers");

const context = vm.createContext({ window: {} });
vm.runInContext(
    `${source.slice(0, helperBoundary)}\n` +
    "globalThis.__drift = { createVideoDriftState, resetVideoDriftState, planVideoDriftCorrection, syncYouTubePlayerTimeline };",
    context
);
const { createVideoDriftState, resetVideoDriftState, planVideoDriftCorrection, syncYouTubePlayerTimeline } = context.__drift;

const TICK_MS = 250;

// A player whose video stalls for `resumeDelay` seconds after every seek, with
// an optional clock error `jitter(tick)` in what it reports.
function simulate({ seconds, resumeDelay = 0, startDrift = 0, jitter = () => 0, rateSkew = 0, plan = planVideoDriftCorrection }) {
    const state = createVideoDriftState();
    let spotify = 10;
    let video = spotify + startDrift;
    let stalledUntil = -Infinity;
    const seeks = [];
    const drifts = [];
    for (let tick = 0, now = 0; now <= seconds * 1000; tick++, now += TICK_MS) {
        const isStalled = now < stalledUntil;
        const action = plan(state, {
            currentTime: video + jitter(tick),
            targetTime: spotify,
            now,
            isPlaying: true,
            isSteady: !isStalled,
        });
        if (action.type === "seek") {
            seeks.push({ now, time: action.time });
            video = action.time;
            stalledUntil = now + resumeDelay * 1000;
        }
        drifts.push(video - spotify);
        spotify += TICK_MS / 1000;
        if (now + TICK_MS > stalledUntil) {
            const playedMs = Math.min(TICK_MS, now + TICK_MS - Math.max(now, stalledUntil));
            video += (playedMs / 1000) * (1 + rateSkew);
        }
    }
    return { state, seeks, finalDrift: drifts[drifts.length - 1] };
}

test("re-seeks at once when the video is more than half a second off", () => {
    const state = createVideoDriftState();
    state.leadSeconds = 0.2;
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: 9, targetTime: 10, now: 0, isPlaying: true }) },
        { type: "seek", time: 10.2 });
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: 9, targetTime: 10, now: 5000, isPlaying: false }) },
        { type: "seek", time: 10 }, "a paused video needs no lead");
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: NaN, targetTime: 4, now: 9000 }) },
        { type: "seek", time: 4 });
});

test("a seek that resumes late no longer leaves the video steadily behind", () => {
    const { seeks, state, finalDrift } = simulate({ seconds: 30, startDrift: -2, resumeDelay: 0.3 });
    assert.ok(Math.abs(finalDrift) <= 0.1, `final drift ${finalDrift.toFixed(3)} s`);
    assert.ok(seeks.length <= 4, `${seeks.length} seeks`);
    assert.ok(state.leadSeconds > 0.15 && state.leadSeconds < 0.45, `learned lead ${state.leadSeconds}`);
});

test("the old half-second threshold left the same player 0.3 s behind for good", () => {
    const oldPlan = (state, { currentTime, targetTime }) =>
        Math.abs(currentTime - targetTime) > 0.5 ? { type: "seek", time: targetTime } : { type: "none" };
    const { finalDrift } = simulate({ seconds: 30, startDrift: -2, resumeDelay: 0.3, plan: oldPlan });
    assert.ok(Math.abs(finalDrift + 0.3) < 0.01, `final drift ${finalDrift.toFixed(3)} s`);
});

test("clock jitter alone never triggers a seek", () => {
    const pattern = [0.08, -0.06, 0.02, -0.09, 0.05, -0.03, 0.07, -0.08];
    const { seeks } = simulate({ seconds: 120, jitter: (tick) => pattern[tick % pattern.length] });
    assert.equal(seeks.length, 0);
});

test("stops chasing drift a player cannot hold", () => {
    // The video keeps falling behind at 10% speed whatever we do.
    const { state, seeks } = simulate({ seconds: 120, rateSkew: -0.1 });
    assert.equal(state.softThresholdSeconds, 0.35);
    // Only the unavoidable half-second re-seeks remain once it backs off.
    const lateSeeks = seeks.filter(({ now }) => now > 60_000);
    assert.ok(lateSeeks.length <= 12, `${lateSeeks.length} seeks in the last minute`);
});

test("a local helper video is eased back with its playback rate", () => {
    const ahead = createVideoDriftState();
    ahead.lastSeekAt = -10_000;
    let action;
    for (let now = 0; now < 1000; now += TICK_MS) {
        action = planVideoDriftCorrection(ahead, { currentTime: 10.1, targetTime: 10, now, isPlaying: true, isSteady: true, canAdjustRate: true });
    }
    assert.deepEqual({ ...action }, { type: "rate", rate: 0.95 });

    const behind = createVideoDriftState();
    for (let now = 0; now < 1000; now += TICK_MS) {
        action = planVideoDriftCorrection(behind, { currentTime: 9.96, targetTime: 10, now, isPlaying: true, isSteady: true, canAdjustRate: true });
    }
    assert.deepEqual({ ...action }, { type: "rate", rate: 1.02 });

    const inSync = createVideoDriftState();
    for (let now = 0; now < 1000; now += TICK_MS) {
        action = planVideoDriftCorrection(inSync, { currentTime: 10.01, targetTime: 10, now, isPlaying: true, isSteady: true, canAdjustRate: true });
    }
    assert.deepEqual({ ...action }, { type: "rate", rate: 1 });
});

test("a new video keeps the learned lead but starts fresh", () => {
    const state = createVideoDriftState();
    state.leadSeconds = 0.3;
    state.samples = [0.2, 0.2];
    state.softThresholdSeconds = 0.35;
    resetVideoDriftState(state);
    assert.equal(state.leadSeconds, 0.3);
    assert.equal(state.samples.length, 0);
    assert.equal(state.softThresholdSeconds, 0.15);
});

function createPlayer({ time, state = 1 }) {
    const calls = [];
    return {
        calls,
        getPlayerState: () => state,
        getCurrentTime: () => time,
        seekTo: (seconds) => calls.push(["seekTo", seconds]),
        playVideo: () => calls.push(["playVideo"]),
        pauseVideo: () => calls.push(["pauseVideo"]),
    };
}

test("the YouTube sync leaves the held pre-roll exactly on the mapped time", () => {
    const driftState = createVideoDriftState();
    driftState.leadSeconds = 0.3;
    const player = createPlayer({ time: 0, state: 2 });
    syncYouTubePlayerTimeline({
        player, targetVideoTime: 0.4, shouldHoldAtStart: false, shouldPlay: true,
        holdState: { isHolding: true, primePending: false }, driftState, now: 0,
    });
    assert.deepEqual(player.calls[0], ["seekTo", 0.4]);
});

test("the YouTube sync corrects steady drift only while playing", () => {
    const run = (playerState, shouldPlay) => {
        const driftState = createVideoDriftState();
        const player = createPlayer({ time: 0, state: playerState });
        const seeks = [];
        for (let now = 0; now <= 6000; now += TICK_MS) {
            const target = 20 + now / 1000;
            player.getCurrentTime = () => target - 0.3;
            player.calls.length = 0;
            syncYouTubePlayerTimeline({
                player, targetVideoTime: target, shouldHoldAtStart: false, shouldPlay,
                holdState: { isHolding: false, primePending: false }, driftState, now,
            });
            seeks.push(...player.calls.filter(([name]) => name === "seekTo"));
        }
        return seeks;
    };
    assert.ok(run(1, true).length >= 1, "playing: steady 0.3 s lag is corrected");
    assert.equal(run(2, false).length, 0, "paused: nothing to correct");
});
