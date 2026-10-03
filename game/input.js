// Keep each held input independent so releasing one never releases another.
export function guardButton(input, source, pressed) {
  const key = source === 'keyboard' ? 'keyGuard' : 'mouseGuard';
  if (pressed && !input[key]) input.parry++;
  input[key] = pressed;
  input.guard = input.keyGuard === true || input.mouseGuard === true;
}
export function resetGuard(input) {
  input.keyGuard = false;
  input.mouseGuard = false;
  input.guard = false;
}
export function mouseButton(input, button, pressed) {
  if (button === 0) input.attack = pressed;
  if (button === 2) guardButton(input, 'mouse', pressed);
}
