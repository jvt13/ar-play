export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const I=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
export function mul(a,b){let c=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)c[j*4+i]=a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];return c;}
export function tr(x,y,z){let m=I();m[12]=x;m[13]=y;m[14]=z;return m;}
export function sc(x,y,z){let m=I();m[0]=x;m[5]=y;m[10]=z;return m;}
export function rx(a){let m=I(),c=Math.cos(a),s=Math.sin(a);m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m;}
export function ry(a){let m=I(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m;}
export function rz(a){let m=I(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m;}
export const chain=(...m)=>m.reduce(mul,I());
export function perspective(fov,aspect,near=.05,far=50){let f=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;m[14]=2*far*near/(near-far);return m;}
const norm=a=>{let d=Math.hypot(...a)||1;return a.map(v=>v/d)};const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function lookAt(eye,target,up=[0,1,0]){let z=norm(eye.map((v,i)=>v-target[i])),x=norm(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
export function normalMatrix(m){let a=[m[0],m[1],m[2]],b=[m[4],m[5],m[6]],c=[m[8],m[9],m[10]],u=cross(b,c),v=cross(c,a),w=cross(a,b),d=dot(a,u)||1;return new Float32Array([...u,...v,...w].map(x=>x/d));}
export function cover(sw,sh,dw,dh){let s=Math.max(dw/sw,dh/sh);return [(dw-sw*s)/2,(dh-sh*s)/2,sw*s,sh*s];}

// Column-major inverse with caller-owned output/scratch, including asymmetric projections.
export function invert4(out,m,work=new Float64Array(32)){
 if(m.length!==16)return false;
 for(let r=0;r<4;r++)for(let c=0;c<8;c++)work[r*8+c]=c<4?m[c*4+r]:(c-4===r?1:0);
 for(let c=0;c<4;c++){
  let pivot=c;for(let r=c+1;r<4;r++)if(Math.abs(work[r*8+c])>Math.abs(work[pivot*8+c]))pivot=r;
  if(!Number.isFinite(work[pivot*8+c])||Math.abs(work[pivot*8+c])<1e-10)return false;
  for(let k=0;k<8;k++){let t=work[c*8+k];work[c*8+k]=work[pivot*8+k];work[pivot*8+k]=t;}
  let d=work[c*8+c];for(let k=0;k<8;k++)work[c*8+k]/=d;
  for(let r=0;r<4;r++)if(r!==c){let f=work[r*8+c];for(let k=0;k<8;k++)work[r*8+k]-=f*work[c*8+k];}
 }
 for(let r=0;r<4;r++)for(let c=0;c<4;c++){let v=work[r*8+c+4];if(!Number.isFinite(v))return false;out[c*4+r]=v;}
 return true;
}

// Existing camera-relative AR convention: project the camera right axis onto XZ.
export function cameraXZ(x,z,pose,out){const n=Math.max(1,Math.hypot(x,z));x/=n;z/=n;const a=pose?pose[0]:1,b=pose?pose[2]:0,h=Math.hypot(a,b)||1;out[0]=(a*x-b*z)/h;out[1]=(b*x+a*z)/h;return out;}
