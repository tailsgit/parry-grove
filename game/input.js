// Track each mouse button independently so releasing parry never releases attack.
export function mouseButton(input, button, pressed) {
  if(button===0)input.attack=pressed;
  if(button===2){if(pressed&&!input.guard)input.parry++;input.guard=pressed;}
}
