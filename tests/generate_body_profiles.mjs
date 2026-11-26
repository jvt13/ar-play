// Development-only derivation from unchanged procedural spheres. Prints JSON, no file mutation.
// Walking has one sin(9t) phase. Sampling 128 phases and 21 walk amplitudes, with the
// existing .025 model-unit pad, also covers bounded interpolation error (<.017 model units).
import {character} from '../src/engine.js';
import {I} from '../src/math.js';
const heights={bip:1.685,nori:1.509,luma:1.665},out={};
for(const id of Object.keys(heights)){
  const bounds=new Array(48);for(let b=0;b<12;b++){bounds[b*4]=bounds[b*4+2]=Infinity;bounds[b*4+1]=bounds[b*4+3]=-Infinity;}
  const collector={draw(kind,m){
    if(kind!=='sphere')throw Error('Unknown model primitive');
    const x=m[12],y=m[13],z=m[14],hx=Math.hypot(m[0],m[4],m[8]),hy=Math.hypot(m[1],m[5],m[9]),hz=Math.hypot(m[2],m[6],m[10]),pad=.025;
    for(let b=0;b<12;b++)if(y+hy+pad>=b*heights[id]/12&&y-hy-pad<=(b+1)*heights[id]/12){const j=b*4;bounds[j]=Math.min(bounds[j],x-hx-pad);bounds[j+1]=Math.max(bounds[j+1],x+hx+pad);bounds[j+2]=Math.min(bounds[j+2],z-hz-pad);bounds[j+3]=Math.max(bounds[j+3],z+hz+pad);}
  }};
  for(let amplitude=0;amplitude<=20;amplitude++)for(let phase=0;phase<128;phase++)character(collector,id,I(),phase*2*Math.PI/128/9,amplitude/20,0,0);
  out[id]=bounds.map((v,i)=>i%2?Math.ceil(v*1e6)/1e6:Math.floor(v*1e6)/1e6);
}
console.log(JSON.stringify(out,null,2));
