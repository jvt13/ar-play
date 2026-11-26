// Synthetic acquisition-to-movement sequences, shared unchanged by every version.
export const chainScenarios=['floor','map-after-placement','enable-after-motion','reposition','resize','noisy-floor','pitched-camera','raised-floor','initial-overlap','concurrent','small','large','historical'];
export function chainFixture(API, scenario) {
  const projection=API.perspective(Math.PI/2,1),pose=API.mul(API.tr(0,1.2,.4),API.rx(scenario==='pitched-camera'?-.85:-.5));
  const width=96,height=72,values=new Float32Array(width*height);
  const boxes=['small','large','map-after-placement','historical','enable-after-motion','reposition','resize'].includes(scenario)?[[.45,scenario==='small'?.57:1.05,.07,scenario==='small'?.19:.65,-1.4,-.4]]:[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const cx=(2*(x+.5)/width-1)/projection[0],cy=(1-2*(y+.5)/height)/projection[5];
    const o=[pose[12],pose[13],pose[14]],d=[pose[0]*cx+pose[4]*cy-pose[8],pose[1]*cx+pose[5]*cy-pose[9],pose[2]*cx+pose[6]*cy-pose[10]];
    let depth=d[1]<0?((scenario==='raised-floor'?.09:0)-o[1])/d[1]:Infinity;
    if(scenario==='noisy-floor')depth*=1+.008*Math.sin(x*17+y*13);
    for(const b of boxes) {
      let lo=0,hi=Infinity;
      for(let a=0;a<3;a++){const bounds=a===0?[b[0],b[1]]:a===1?[b[2],b[3]]:[b[4],b[5]];let p=(bounds[0]-o[a])/d[a],q=(bounds[1]-o[a])/d[a];lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));}
      if(lo<=hi&&hi>0)depth=Math.min(depth,lo);
    }
    values[y*width+x]=depth>=.15&&depth<=6?depth:0;
  }
  return {info:{width,height,rawValueToMeters:1,data:values.buffer,normDepthBufferFromNormView:{matrix:API.I()}},view:{projectionMatrix:projection,transform:{matrix:pose}}};
}
export function runChain(API,{scenario='floor',scale=.81}={}) {
  const s=new API.ARCollisions({}, {},()=>0),p=[0,0,-.8],f=chainFixture(API,scenario);
  s.start('waiting');s.place(p);s.setCharacter('bip',scale,p);s.setEnabled(scenario!=='enable-after-motion');
  const trace=[];let distance=0,streak=0,maxStreak=0,maxOccupied=0;
  for(let i=0;i<400;i++) {
    const t=i*16+16;
    if(i===70&&scenario==='enable-after-motion')s.setEnabled(true);
    if(i===100&&scenario==='reposition'){p[0]=-.15;s.place(p);}
    const size=scenario==='resize'&&i>=120?1:scale;
    s.setCharacter('bip',size,p);s.frame(t,true);
    const dx=i<100?.005:i<200?0:i<300?-.005:0,dz=i<100?0:i<200?.005:i<300?0:-.005;
    s.setInput(dx/.005,dz/.005);s.setIntent(dx/.016,dz/.016,t);s.requestPose?.(Math.atan2(dx,dz),false,t);
    if(s.wantsDepth(t)&&!(scenario==='map-after-placement'&&i<30)&&!(scenario==='historical'&&i>120))s.accept(t,API.createDepthReader(f.info,'float32'),f.info,f.view);
    if((scenario==='initial-overlap'||scenario==='concurrent')&&i<30&&i%8===0){s.map.begin(t,p,s.volume.height);for(let z=-1.5;z<.5;z+=.04)for(let y=.08;y<.5;y+=.08)s.map.observe(.12,y,z);}
    if(scenario==='concurrent'&&i<150){s.probe.count=1;s.probe.history.set([-.28,.2,-.8,t,0,1,1]);}
    const out=s.move(p,dx,dz,t),moved=Math.hypot(out.x-p[0],out.z-p[2]);distance+=moved;
    p[0]=out.x;p[2]=out.z;streak=s.blocked?streak+1:0;maxStreak=Math.max(streak,maxStreak);maxOccupied=Math.max(maxOccupied,s.map.occupiedCount);
    trace.push([p[0],p[2],s.map.occupiedCount,s.probe.count,s.blocked,s.map.releasedCount]);
  }
  return {scenario,scale,distance,final:[p[0],p[2]],maxStreak,maxOccupied,trace};
}
