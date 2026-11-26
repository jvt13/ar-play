import {character} from '../src/engine.js';import {sc} from '../src/math.js';
export function contactCase(API,{id='bip',scale=.81,angle=0}={}){
 const s=new API.ARCollisions({}, {},()=>0),p=[0,0,0],nx=Math.cos(angle),nz=Math.sin(angle);s.start('waiting');s.place(p);s.setCharacter(id,scale,p);s.setEnabled(true);const v=s.volume;
 for(let t=0;t<=2000;t+=125){s.map.begin(t,p,v.height);for(let a=-1;a<=1;a+=.012)for(let y=.065;y<v.height;y+=.05)s.map.observe(nx-nz*a,y,nz+nx*a);}
 let requested=0,permitted=0;
 for(let i=0;i<120;i++){const t=2100+i*16;s.frame(t,true);const r=s.move(p,nx*.015,nz*.015,t);requested+=.015;permitted+=Math.hypot(r.x-p[0],r.z-p[2]);p[0]=r.x;p[2]=r.z;}
 let visual=0;character({draw(_kind,m){visual=Math.max(visual,nx*m[12]+nz*m[14]+Math.hypot(nx*m[0]+nz*m[2],nx*m[4]+nz*m[6],nx*m[8]+nz*m[10]));}},id,sc(v.size,v.size,v.size),0,0,0,0);
 const distance=1-nx*p[0]-nz*p[2],contact=s.contact;
 return {id,scale,angle,requested,permitted,knownNormalDistance:distance,visualSupport:visual,physicalRadius:v.radius,bodyGap:distance-visual,physicalGap:distance-v.radius,estimatedDistance:contact?.surfaceDistance??null,estimatedGap:contact?.clearance??null,mapError:contact?distance-contact.surfaceDistance:null,pointMargin:s.map.config.pointMargin,skin:s.resolver.skin,cellSize:s.map.config.cellSize,penetration:Math.max(0,v.radius-distance),probeSamples:s.probe.count,refined:contact?.refined??false};
}
