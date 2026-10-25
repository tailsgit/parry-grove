import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roomCode,
  validRoomCode,
  inviteRoom,
  inviteLink,
  lobbyState,
} from "../game/menu-model.js";
import { member, roomState, applyAction } from "../game/rooms.js";
test("invite parsing only accepts valid room codes and copied links contain no credentials", () => {
  assert.equal(inviteRoom("?room=abc234"), "ABC234");
  assert.equal(inviteRoom("?room=AB%3C234"), null);
  assert.equal(inviteRoom("?room=AB1234"), null);
  assert.equal(inviteRoom("?room=ABC2347"), null);
  assert.equal(roomCode(" ab c234 "), "ABC234");
  assert.equal(validRoomCode("ABC234"), true);
  const u = new URL(
    inviteLink(
      "https://name:secret@example.com/game?token=private&room=OLD234#state",
      "NEW234",
    ),
  );
  assert.equal(u.search, "?room=NEW234");
  assert.equal(u.hash, "");
  assert.equal(u.username, "");
  assert.equal(u.password, "");
});
test("only the host can change a lobby route; changed routes require guests to ready again", () => {
  const h = member("Host", "sword", 1),
    g = member("Guest", "sword", 1),
    r = roomState(h, 1);
  r.members.push(g);
  h.ready = g.ready = true;
  assert.throws(
    () => applyAction(r, g, { action: "runType", runType: "endless" }, 2),
    /Only the host/,
  );
  assert.equal(r.runType, "story");
  assert.throws(
    () => applyAction(r, h, { action: "runType", runType: "broken" }, 2),
    /Story or Endless/,
  );
  applyAction(r, h, { action: "runType", runType: "endless" }, 2);
  assert.equal(r.runType, "endless");
  assert.equal(h.ready, true);
  assert.equal(g.ready, false);
  assert.throws(
    () => applyAction(r, h, { action: "start" }, 3),
    /Everyone must be ready/,
  );
  applyAction(r, g, { action: "ready" }, 4);
  applyAction(r, h, { action: "start" }, 5);
  assert.equal(r.game.runType, "endless");
  assert.throws(
    () => applyAction(r, h, { action: "runType", runType: "story" }, 6),
    /before starting/,
  );
});
test("host start availability follows guest readiness and connection, not local button state", () => {
  const room = {
    host: "h",
    members: [
      { id: "h", ready: false },
      { id: "g", ready: false },
    ],
  };
  assert.equal(lobbyState(room, "h").canStart, false);
  room.members[1].ready = true;
  assert.equal(lobbyState(room, "h").canStart, true);
  assert.equal(lobbyState(room, "g").canStart, false);
  room.members[1].connected = false;
  assert.equal(lobbyState(room, "h").canStart, false);
});
