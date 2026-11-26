import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {runMapping} from './mapping-fixtures.mjs';
import {observationSequence} from './mapping-memory.mjs';import {contactCase} from './contact-decomposition.mjs';
const rows=[],memory=[],contacts=[];
for(const [version,directory] of [['1.1.8',process.argv[2]],['candidate','.']]){
  const modules=await Promise.all(['collision','depth','math'].map(name=>import(pathToFileURL(resolve(directory,`src/${name}.js`))))),API=Object.assign({},...modules);
  const cases=[{height:.09},{slope:.12},{slope:.12,immediate:true},{slope:.12,noise:.003},{slope:.12,reduced:true}];
  for(const id of ['bip','nori','luma'])for(const scale of [.4,.81,1]){
    for(const shape of ['ball','slipper','toy','leg','step','bed','wall'])cases.push({id,scale,shape});
    for(const angle of [0,Math.PI/4])contacts.push({version,...contactCase(API,{id,scale,angle})});
  }
  for(const options of cases){
    const {system,trace,...result}=runMapping(API,options);rows.push({version,...result,maxX:Math.max(...trace.map(r=>r[1])),last:trace.at(-1)});
  }
  const {trace,...result}=observationSequence(API);memory.push({version,...result});
}
console.log(JSON.stringify({results:rows,memory,contacts},null,2));
