// Conservative union of horizontal cylinders, sampled from unchanged sphere transforms
// across 512 animation phases, all walk/dance combinations; includes .025 model-unit margin.
export const PROFILES = Object.freeze({
  bip: Object.freeze([.494,.494,.755,.771,.771,.771,.722,.722,.722,.722,.592,.347]),
  nori: Object.freeze([.494,.871,.871,.871,.771,.771,.743,.642,.633,.633,.579,.579]),
  luma: Object.freeze([.494,.494,.753,.771,.771,.771,.773,.773,.773,.773,.747,.494]),
});
export function radiusAt(volume, low, high = low) {
  if (!volume.profile) return volume.radius;
  const n = volume.profile.length, a = Math.max(0, Math.floor((low-volume.ground)/volume.height*n)),
    b = Math.min(n-1, Math.floor((high-volume.ground)/volume.height*n));
  let radius = 0;
  for (let i = Math.min(n-1,a); i <= Math.max(0,b); i++) radius = Math.max(radius, volume.profile[i]*volume.size);
  return radius;
}
