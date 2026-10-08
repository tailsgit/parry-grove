// Compare immutable HUD samples; healing and cleansing are not damage feedback.
export function vitalityChange(before,after){
  if(!before||before.id!==after.id)return {healthLoss:0,internalGain:0};
  return {
    healthLoss:Math.max(0,before.hp-after.hp),
    internalGain:Math.max(0,after.internal-before.internal),
  };
}
