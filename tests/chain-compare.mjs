import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {runChain,chainScenarios} from './chain-fixtures.mjs';
import {revalidationSequence} from './revalidation-sequences.mjs';
const results=[];
const revalidation=[];
for(const [version,directory] of [['1.1.5',process.argv[2]],['1.1.7',process.argv[3]],['candidate','.']]) {
 const modules=await Promise.all(['collision','depth','math','spatial-map','revalidation'].map(name=>import(pathToFileURL(resolve(directory,`src/${name}.js`)))));
 const API=Object.assign({},...modules);
 for(const scale of [.4,.81,1])for(const scenario of chainScenarios)results.push({version,...runChain(API,{scenario,scale})});
 for(const scenario of ['removed','near-wall','partial','off-view','occluded','missing','noise'])revalidation.push({version,...revalidationSequence(API,scenario)});
}
console.log(JSON.stringify({reference:'14e6ca2fff59065213abc9dc4b57647328c66368',results,revalidation}));
