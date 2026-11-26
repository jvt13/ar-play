// Historical oriented mathematics; never imported by application modules.
import {BODY_PROFILES} from './body-profiles.js';
import {radiusAt} from '../../src/volume.js';
export {radiusAt} from '../../src/volume.js';
// Rest/walk use one orientation-dependent support envelope. Dance retains the proven
// all-animation circles. No geometry is sampled or allocated in the XR frame.
export function configurePose(volume,id,yaw,dance=false){
  volume.bodyBounds=dance?null:BODY_PROFILES[id];volume.poseYaw=yaw;
  volume.poseCos=Math.cos(yaw);volume.poseSin=Math.sin(yaw);volume.poseMode=dance?'legacy-dance':'oriented-walk';
  return volume;
}
export function supportAt(volume,low,high,nx,nz){
  const cap=radiusAt(volume,low,high),b=volume.bodyBounds;
  if(!b)return cap;
  const length=Math.hypot(nx,nz);if(length<1e-10)return cap;
  const x=(volume.poseCos*nx-volume.poseSin*nz)/length,z=(volume.poseSin*nx+volume.poseCos*nz)/length;
  const a=Math.max(0,Math.min(11,Math.floor((low-volume.ground)/volume.height*12))),end=Math.max(0,Math.min(11,Math.floor((high-volume.ground)/volume.height*12)));
  let support=0;
  for(let band=a;band<=Math.max(a,end);band++){const j=band*4;support=Math.max(support,(x>=0?b[j+1]*x:b[j]*x)+(z>=0?b[j+3]*z:b[j+2]*z));}
  // Both bounds contain the unchanged rendered body, so their minimum remains a
  // conservative support limit. Keep the old circles for broad phase and fallback.
  return Math.min(cap,support*volume.size);
}

// Separating-axis query against a measured AABB or finite probe segment. Using a
// directional support as if it were a circular radius would falsely block tangents.
// The four box axes and segment normal are tested independently; the previous
// circular envelope remains an additional conservative bound, never a shrunken body.
export function orientedDepth(v,low,high,x,z,cx,cz,ex,ez,skin,tx=1,tz=0,half=0){
  let depth=Infinity;
  const dx=cx-x,dz=cz-z;
  for(let i=0;i<6;i++){
    let nx,nz;
    if(i===0){nx=1;nz=0;}else if(i===1){nx=0;nz=1;}
    else if(i===2){nx=v.poseCos;nz=-v.poseSin;}else if(i===3){nx=v.poseSin;nz=v.poseCos;}
    else if(i===4){nx=tz;nz=-tx;}
    else {const a=half?Math.max(-half,Math.min(half,-dx*tx-dz*tz)):0;nx=dx+a*tx;nz=dz+a*tz;const n=Math.hypot(nx,nz);if(n<1e-10)continue;nx/=n;nz/=n;}
    const distance=dx*nx+dz*nz,sign=distance<0?-1:1;
    const overlap=supportAt(v,low,high,nx*sign,nz*sign)+skin+ex*Math.abs(nx)+ez*Math.abs(nz)+half*Math.abs(tx*nx+tz*nz)-Math.abs(distance);
    depth=Math.min(depth,overlap);if(depth<=0)return depth;
  }
  return depth;
}
