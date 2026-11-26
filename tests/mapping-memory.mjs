import {depthScene} from './mapping-fixtures.mjs';
// Same views, native depth and schedule for both versions; no TTL shortcut.
export function observationSequence(API){
 const s=new API.ARCollisions({}, {},()=>0),p=[0,0,-.8];s.start('waiting');s.place(p);s.setCharacter('bip',.81,p);s.setEnabled(true);
 let time=0,firstConfirmed=null,firstReleased=null,allReleased=null;const trace=[];
 function acquire(options,n){const f=depthScene(API,options);for(let i=0;i<n;i++){
   time+=125;s.frame(time,true);s.accept(time,API.createDepthReader(f.info,'float32'),f.info,f.view);
   if(s.map.occupiedCount)firstConfirmed??=time;if(s.map.releasedCount)firstReleased??=time;
   trace.push([time,s.map.occupiedCount,s.map.releasedCount]);
   if(time>15500&&s.map.occupiedCount===0)allReleased??=time;
 }}
 acquire({shape:'bed',crop:.55},12);const partial=s.map.occupiedCount;
 acquire({shape:'bed',cameraX:.25,yaw:-.1},20);const otherAngle=s.map.occupiedCount;
 acquire({shape:'bed'},12);const returned=s.map.occupiedCount,consolidated=s.map.stats(time).consolidated;
 const stopped=s.move(p,.6,0,time).x;
 for(let i=0;i<80;i++){time+=125;s.frame(time,true);}const missing=s.map.occupiedCount;
 acquire({shape:'bed'},8);const present=s.map.occupiedCount;
 const removedAt=time;
 acquire({shape:'bed',visible:false},120);const incompleteRelease=s.map.occupiedCount;
 acquire({shape:'bed',visible:false,pitch:-.9,cameraX:.6},120);
 const released=s.map.occupiedCount,allowed=s.move(p,.6,0,time).x;
 return {partial,otherAngle,returned,consolidated,missing,present,stopped,removedAt,incompleteRelease,released,allowed,firstConfirmed,firstReleased,allReleased,trace};
}
