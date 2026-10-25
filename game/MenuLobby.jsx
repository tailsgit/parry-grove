"use client";
import { useEffect, useRef, useState } from "react";
import { COLORS } from "./config.js";
import {
  inviteLink,
  lobbyState,
  roomCode,
  validRoomCode,
} from "./menu-model.js";
const ROUTES = [
  ["story", "Story", "Three areas. One final victory."],
  ["endless", "Endless", "Unlimited rooms. A shop every five."],
];
export default function MenuLobby({
  lobby,
  room,
  myId,
  name,
  onName,
  code,
  onCode,
  runType,
  onRoute,
  busy,
  onSolo,
  onCreate,
  onJoin,
  onPractice,
  onReady,
  onStart,
  onLeave,
  latency,
}) {
  const heading = useRef(null),
    roomInput = useRef(null),
    wasLobby = useRef(false),
    copyTimer = useRef(null);
  const [copied, setCopied] = useState(""),
    [copyError, setCopyError] = useState("");
  const state = lobbyState(room, myId);
  useEffect(() => {
    queueMicrotask(() => {
      setCopied("");
      setCopyError("");
    });
    if (wasLobby.current !== lobby) {
      heading.current?.focus();
      wasLobby.current = lobby;
    }
    return () => clearTimeout(copyTimer.current);
  }, [lobby]);
  async function copy(kind) {
    try {
      const text =
        kind === "code"
          ? room.code
          : inviteLink(window.location.href, room.code);
      await navigator.clipboard.writeText(text);
      setCopyError("");
      setCopied(kind);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopyError(
        kind === "code"
          ? "Select the room code to copy it."
          : "Copy this invite link:",
      );
      if (kind === "code") {
        roomInput.current?.focus();
        roomInput.current?.select();
      }
    }
  }
  function navigate(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (lobby && !busy) onLeave();
    else heading.current?.focus();
  }
  return (
    <section
      className="menu-card entry-card"
      aria-labelledby="entry-title"
      onKeyDown={navigate}
    >
      <div className="entry-content" key={lobby ? "party" : "route"}>
        {lobby ? (
          <>
            <div className="party-heading">
              {state.host ? (
                <label className="party-route">
                  <span className="menu-sr-only">Party route</span>
                  <select
                    aria-label="Party route"
                    value={runType}
                    disabled={busy}
                    onChange={(e) => onRoute(e.target.value)}
                  >
                    <option value="story">STORY</option>
                    <option value="endless">ENDLESS</option>
                  </select>
                </label>
              ) : (
                <span className="party-route route-badge">
                  {runType.toUpperCase()}
                </span>
              )}
              <button
                className="text-button leave-party"
                disabled={busy}
                onClick={onLeave}
              >
                ← Leave room
              </button>
            </div>
            <h2 id="entry-title" ref={heading} tabIndex={-1}>
              Gather at the grove.
            </h2>
            <label className="field-label" htmlFor="party-room-code">
              INVITE YOUR PARTY
            </label>
            <input
              ref={roomInput}
              id="party-room-code"
              className="party-code"
              aria-label="Room code"
              readOnly
              value={room?.code || ""}
              onFocus={(e) => e.target.select()}
            />
            <div className="invite-actions">
              <button
                className="secondary"
                aria-label="Copy code"
                onClick={() => copy("code")}
              >
                {copied === "code" ? "Copied!" : "Copy code"}
              </button>
              <button
                className="secondary"
                aria-label="Copy invite link"
                onClick={() => copy("link")}
              >
                {copied === "link" ? "Copied!" : "Copy invite link ↗"}
              </button>
            </div>
            <span className="menu-sr-only" role="status">
              {copied ? "Copied to clipboard." : ""}
            </span>
            {copyError && (
              <div className="copy-fallback" role="status">
                {copyError}
                {copyError === "Copy this invite link:" && (
                  <input
                    aria-label="Invite link"
                    readOnly
                    value={inviteLink(window.location.href, room.code)}
                    onFocus={(e) => e.target.select()}
                  />
                )}
              </div>
            )}
            <div className="party-list-heading">
              <span className="field-label">YOUR PARTY</span>
              <span>{room?.members.length || 0} / 4</span>
            </div>
            <ul className="party-slots" aria-label="Party members">
              {[0, 1, 2, 3].map((slot) => {
                const member = room?.members.find((m) => m.slot === slot),
                  online = member?.connected !== false;
                const ping = online
                  ? (member?.pingMs ??
                    (member?.id === myId && latency > 0 ? latency : null))
                  : null;
                return (
                  <li
                    key={slot}
                    className={`party-slot${member ? "" : " is-empty"}`}
                  >
                    {member ? (
                      <>
                        <span
                          className="party-dot"
                          style={{ background: COLORS[slot] }}
                          aria-hidden="true"
                        />
                        <span className="party-member-name" title={member.name}>
                          {member.name}
                          <small>
                            {member.id === room.host
                              ? "Host"
                              : member.id === myId
                                ? "You"
                                : "Adventurer"}
                            {!online ? " · Reconnecting" : ""}
                          </small>
                        </span>
                        <span
                          className={`party-ready${member.ready && online ? " is-ready" : ""}`}
                        >
                          {member.ready && online ? "READY" : "WAITING"}
                        </span>
                        <span
                          className="party-ping"
                          data-quality={
                            ping != null && ping <= 80 ? "good" : "waiting"
                          }
                          title={
                            ping == null
                              ? "Latency not available"
                              : "Measured round-trip latency"
                          }
                        >
                          {ping == null ? "—" : `${ping} ms`}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="party-empty-dot" aria-hidden="true">
                          ·
                        </span>
                        Waiting for adventurer...
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="party-status" role="status">
              {state.host
                ? state.canStart
                  ? "Your party is ready. Let’s head in."
                  : "Waiting for your party to ready up."
                : state.ready
                  ? "Ready. Waiting for the host to start."
                  : "Ready when you are. Your kit awaits inside."}
            </p>
            {state.host ? (
              <button
                className="primary"
                data-ui-confirm="true"
                disabled={busy || !state.canStart}
                onClick={onStart}
              >
                Start run <span aria-hidden="true">↗</span>
              </button>
            ) : (
              <button
                className="primary"
                data-ui-confirm="true"
                disabled={busy}
                onClick={onReady}
              >
                {state.ready ? "Unready" : "Ready up"}
                <span aria-hidden="true">{state.ready ? "↶" : "✓"}</span>
              </button>
            )}
            <p className="entry-caption">
              One exclusive weapon kit for each adventurer.
            </p>
          </>
        ) : (
          <>
            <h2 id="entry-title" ref={heading} tabIndex={-1}>
              Choose your route.
            </h2>
            <div
              className="run-mode-options"
              role="group"
              aria-label="Run mode"
            >
              {ROUTES.map(([type, title, description]) => (
                <button
                  key={type}
                  className={`run-mode-card${runType === type ? " is-selected" : ""}`}
                  aria-pressed={runType === type}
                  disabled={busy}
                  onClick={() => onRoute(type)}
                >
                  <strong>{title}</strong>
                  <small>{description}</small>
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="name">
              ADVENTURER NAME
            </label>
            <input
              id="name"
              autoComplete="nickname"
              value={name}
              maxLength={18}
              disabled={busy}
              onChange={(e) => onName(e.target.value)}
              placeholder="Adventurer"
            />
            <div className="entry-actions">
              <button
                className="primary"
                data-ui-confirm="true"
                disabled={busy}
                onClick={onSolo}
              >
                Play solo <span aria-hidden="true">↗</span>
              </button>
              <button
                className="secondary create-party"
                data-ui-confirm="true"
                disabled={busy}
                onClick={onCreate}
              >
                {busy ? "Connecting…" : "Create co-op room"}
                <span aria-hidden="true">+</span>
              </button>
            </div>
            <form
              className="join-form"
              aria-label="Join a co-op room"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && validRoomCode(code)) onJoin();
              }}
            >
              <input
                aria-label="Six-character room code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="ROOM CODE"
                maxLength={6}
                value={code}
                disabled={busy}
                onChange={(e) => onCode(roomCode(e.target.value))}
              />
              <button
                type="submit"
                data-ui-confirm="true"
                disabled={busy || !validRoomCode(code)}
              >
                JOIN ↗
              </button>
            </form>
            <div className="entry-footer">
              <button
                className="text-button"
                disabled={busy}
                onClick={onPractice}
              >
                Combat practice <span aria-hidden="true">↗</span>
              </button>
              <span>1–4 adventurers</span>
            </div>
            <p className="entry-caption">
              Pick your weapon kit inside. Mouse & keyboard.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
