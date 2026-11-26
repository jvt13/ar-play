// Analytic synthetic surfaces. Identical native pixels and inputs for baseline/candidate.
export function depthScene(API,{height=0,slope=0,noise=0,shape='floor',yaw=0,pitch=-.5,cameraX=0,visible=true,crop=1,objectLift=0}={}){
  const projection=API.perspective(Math.PI/2,1),pose=API.mul(API.tr(cameraX,1.2,.4),API.mul(API.ry(yaw),API.rx(pitch))),width=160,heightPixels=90,data=new Float32Array(width*heightPixels);
  const box=shape==='bed'?[.45,.065,-1.6,1.4,.5,-.4]:shape==='slipper'?[.5,.01,-.95,.67,.075,-.65]:shape==='step'?[.5,.01,-1.8,1.2,.09,.1]:shape==='toy'?[.5,.02,-.9,.62,.14,-.7]:null;
  if(box){box[1]+=objectLift;box[4]+=objectLift;}
  for(let y=0;y<heightPixels;y++)for(let x=0;x<width;x++){
    const cx=(2*(x+.5)/width-1)/projection[0],cy=(1-2*(y+.5)/heightPixels)/projection[5],o=[pose[12],pose[13],pose[14]],d=[pose[0]*cx+pose[4]*cy-pose[8],pose[1]*cx+pose[5]*cy-pose[9],pose[2]*cx+pose[6]*cy-pose[10]];
    const floor=(height+slope*o[0]-o[1])/(d[1]-slope*d[0]);let t=floor>0?floor:Infinity;
    if(noise)t*=1+noise*Math.sin(x*17+y*13);
    if(visible&&box){
      let low=0,high=Infinity;for(let a=0;a<3;a++){const p=(box[a]-o[a])/d[a],q=(box[a+3]-o[a])/d[a];low=Math.max(low,Math.min(p,q));high=Math.min(high,Math.max(p,q));}
      if(low<=high&&high>0)t=Math.min(t,low);
    }
    if(visible&&shape==='wall'){const hit=(.8-o[0])/d[0];if(hit>0)t=Math.min(t,hit);}
    if(visible&&(shape==='ball'||shape==='leg')){
      const ox=o[0]-.55,oz=o[2]+.8,oy=o[1]-.12-objectLift,r=shape==='leg'?.028:.09;
      const a=d[0]**2+d[2]**2+(shape==='ball'?d[1]**2:0),b=2*(ox*d[0]+oz*d[2]+(shape==='ball'?oy*d[1]:0)),c=ox**2+oz**2+(shape==='ball'?oy**2:0)-r*r,disc=b*b-4*a*c;
      if(disc>=0){const hit=(-b-Math.sqrt(disc))/(2*a),hy=o[1]+hit*d[1];if(hit>0&&(shape==='ball'||hy>=.01+objectLift&&hy<=.45+objectLift))t=Math.min(t,hit);}
    }
    data[y*width+x]=x/width<crop&&t>=.15&&t<=6?t:0;
  }
  return {info:{width,height:heightPixels,rawValueToMeters:1,data:data.buffer,normDepthBufferFromNormView:{matrix:API.I()}},view:{projectionMatrix:projection,transform:{matrix:pose}}};
}
export function runMapping(API,{id='bip',scale=.81,height=0,slope=0,noise=0,shape='floor',frames=400,immediate=false,reduced=false,objectLift=0}={}){
  const s=new API.ARCollisions({}, {},()=>0),p=[0,0,-.8],f=depthScene(API,{height,slope,noise,shape,objectLift});
  s.start('waiting');s.place(p);s.setCharacter(id,scale,p);s.setEnabled(true);
  if(reduced){s.columns=16;s.rows=12;s.interval=333;s.adaptSpatial=()=>{};}
  let distance=0,rejected=0,streak=0,maxStreak=0,maxObstaclePoints=0,maxProbeEvidence=0,maxLocalQueries=0,firstOccupied=null,firstBlocked=null;const trace=[];
  for(let i=0;i<frames;i++){
    const t=16+i*16,walking=immediate||i>=24,dx=walking?(i<frames*.65?.005:-.005):0;
    s.setCharacter(id,scale,p);s.frame(t,true);s.setInput(Math.sign(dx),0);s.setIntent(dx/.016,0,t);s.requestPose?.(Math.atan2(dx,0),false,t);
    if(s.wantsDepth(t))s.accept(t,API.createDepthReader(f.info,'float32'),f.info,f.view);
    if(s.localQueries>12||s.used>432)throw Error('local reconstruction budget exceeded');
    maxObstaclePoints=Math.max(maxObstaclePoints,s.ground?.obstaclePoints||0);maxLocalQueries=Math.max(maxLocalQueries,s.localQueries||0);
    maxProbeEvidence=Math.max(maxProbeEvidence,s.probe.used);
    const r=s.move(p,dx,0,t),step=Math.hypot(r.x-p[0],r.z-p[2]);distance+=step;p[0]=r.x;p[2]=r.z;
    if(s.blocked){rejected++;streak++;firstBlocked??=t;}else streak=0;maxStreak=Math.max(streak,maxStreak);
    if(s.map.occupiedCount)firstOccupied??=t;
    trace.push([t,p[0],s.blocked,s.map.occupiedCount,s.ground?.certified??false,s.probe.count]);
  }
  return {id,scale,height,slope,noise,shape,immediate,reduced,distance,rejected,maxStreak,maxObstaclePoints,maxProbeEvidence,maxLocalQueries,firstOccupied,firstBlocked,finalX:p[0],ground:s.ground?.snapshot(),trace,system:s};
}
