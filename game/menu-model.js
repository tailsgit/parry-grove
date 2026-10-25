export const ADVENTURER_NAME_KEY = "parry-grove-adventurer-name";
export function readAdventurerName() {
  try {
    const value = localStorage.getItem(ADVENTURER_NAME_KEY);
    return typeof value === "string" && value.trim()
      ? value.slice(0, 18)
      : "Adventurer";
  } catch {
    return "Adventurer";
  }
}
export function saveAdventurerName(value) {
  try {
    localStorage.setItem(ADVENTURER_NAME_KEY, value.slice(0, 18));
  } catch {}
}
export function roomCode(value = "") {
  return value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 6);
}
export function validRoomCode(value) {
  return /^[A-Z2-9]{6}$/.test(value);
}
export function inviteRoom(search) {
  const value = new URLSearchParams(search).get("room")?.trim().toUpperCase();
  return validRoomCode(value) ? value : null;
}
export function inviteLink(href, code) {
  const url = new URL(href);
  url.search = "";
  url.username = "";
  url.password = "";
  url.searchParams.set("room", code);
  url.hash = "";
  return url.toString();
}
export function lobbyState(room, id) {
  const host = room?.host === id,
    member = room?.members.find((m) => m.id === id);
  const peers = room?.members.filter((m) => m.id !== id) || [];
  return {
    host,
    ready: !!member?.ready,
    canStart: host && peers.every((m) => m.ready && m.connected !== false),
    readyCount:
      room?.members.filter((m) => m.ready && m.connected !== false).length || 0,
  };
}
