export function plane({height=0,slopeX=0,slopeZ=0,noise=0,minX=-.48,maxX=.48,minZ=-.48,maxZ=.48,spacing=.06,offset=[0,0,0],hole=null}={}){
 const p=[];let k=0;for(let x=minX;x<=maxX+1e-8;x+=spacing)for(let z=minZ;z<=maxZ+1e-8;z+=spacing){if(hole&&hole(x,z))continue;p.push(offset[0]+x,offset[1]+height+slopeX*x+slopeZ*z+noise*Math.sin(k++*17),offset[2]+z);}return new Float64Array(p);
}
export function combine(...clouds){const a=new Float64Array(clouds.reduce((n,p)=>n+p.length,0));let i=0;for(const p of clouds){a.set(p,i);i+=p.length;}return a;}
export function wall({x=.2,minY=0,maxY=.9,spacing=.06,minZ=-.48,maxZ=.48}={}){const a=[];for(let y=minY;y<=maxY;y+=spacing)for(let z=minZ;z<=maxZ;z+=spacing)a.push(x,y,z);return new Float64Array(a);}
export function sphere(radius=.12){const p=[];for(let i=1;i<15;i++)for(let j=0;j<20;j++){const a=i*Math.PI/15,b=j*Math.PI/10;p.push(radius*Math.sin(a)*Math.cos(b),.3+radius*Math.cos(a),radius*Math.sin(a)*Math.sin(b));}return new Float64Array(p);}
export function observe(layer,points,{frames=12,start=0,dt=250,camera=null}={}){for(let i=0;i<frames;i++)layer.update(start+i*dt,points,points.length/3,camera);return layer.snapshot(start+(frames-1)*dt);}
