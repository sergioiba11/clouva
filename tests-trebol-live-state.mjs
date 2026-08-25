import assert from "node:assert/strict";
import test from "node:test";
import {
  initialTrebolLiveState,
  reduceTrebolLiveState,
} from "./lib/clouva-ai/live/state-machine.ts";

test("models the main permission, speech and playback lifecycle", () => {
  let state = initialTrebolLiveState;
  state = reduceTrebolLiveState(state, { type: "REQUEST_PERMISSION" });
  assert.equal(state.status, "requesting_permission");
  state = reduceTrebolLiveState(state, { type: "PERMISSION_GRANTED" });
  assert.equal(state.status, "connecting");
  state = reduceTrebolLiveState(state, { type: "CONNECTED" });
  state = reduceTrebolLiveState(state, { type: "USER_SPEECH_STARTED" });
  assert.equal(state.status, "user_speaking");
  state = reduceTrebolLiveState(state, { type: "USER_SPEECH_ENDED" });
  assert.equal(state.status, "trebol_thinking");
  state = reduceTrebolLiveState(state, { type: "MODEL_AUDIO_STARTED" });
  assert.equal(state.status, "trebol_speaking");
  state = reduceTrebolLiveState(state, { type: "INTERRUPTED" });
  assert.equal(state.status, "interrupted");
});

test("keeps the resumption handle across reconnects", () => {
  let state = reduceTrebolLiveState(initialTrebolLiveState, {
    type: "RESUMPTION_HANDLE",
    handle: "resume-1",
  });
  state = reduceTrebolLiveState(state, { type: "RECONNECTING" });
  assert.equal(state.reconnectAttempt, 1);
  assert.equal(state.resumptionHandle, "resume-1");
  state = reduceTrebolLiveState(state, { type: "RESUMED" });
  assert.equal(state.status, "connected");
  assert.equal(state.reconnectAttempt, 0);
});

test("mute prevents a false user-speaking transition", () => {
  const muted = reduceTrebolLiveState(initialTrebolLiveState, { type: "MUTE_CHANGED", muted: true });
  assert.equal(reduceTrebolLiveState(muted, { type: "USER_SPEECH_STARTED" }), muted);
});
