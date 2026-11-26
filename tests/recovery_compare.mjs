// Usage: node tests/recovery_compare.mjs reports/v115/ reports/v116/
// Historical snapshots are local, extracted by git show; never fetched at runtime.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {runSequence, scales} from './collision-sequences.mjs';
import {revalidationSequence} from './revalidation-sequences.mjs';
const versions = [['1.1.5', process.argv[2], false], ['1.1.6', process.argv[3], true], ['candidate-circular', '.', false], ['candidate-oriented-experimental', '.', true]];
const results = [];
const revalidation = [];
for (const [version, directory, oriented] of versions) {
  if (!directory) throw Error('Pass both historical snapshot directories');
  const API = await import(pathToFileURL(resolve(directory, 'src/collision.js')));
  for (const scale of scales) for (const scene of ['free','rapid','wall','corridor','competing','overlap','noise','historical']) {
    const {metrics} = runSequence(API, {scale, scene, oriented});
    results.push({version, scale, scene, ...metrics});
  }
  const modules = await Promise.all(['spatial-map','revalidation','depth','math'].map(name => import(pathToFileURL(resolve(directory, `src/${name}.js`)))));
  const combined = Object.assign({}, ...modules);
  for (const scenario of ['removed','near-wall','partial','off-view','occluded','missing','noise']) revalidation.push({version,...revalidationSequence(combined,scenario)});
}
console.log(JSON.stringify({kind: 'SYNTHETIC temporal comparison; same inputs in every version', results, revalidation}, null, 2));
