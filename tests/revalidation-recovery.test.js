import test from 'node:test';
import assert from 'node:assert/strict';
import * as spatial from '../src/spatial-map.js';
import * as revalidation from '../src/revalidation.js';
import * as depth from '../src/depth.js';
import * as math from '../src/math.js';
import {revalidationSequence} from './revalidation-sequences.mjs';
const API = {...spatial, ...revalidation, ...depth, ...math};
for (const scenario of ['removed','near-wall','partial','off-view','occluded','missing','noise']) {
  test(`ARP-004H revalidation temporal ${scenario}`, () => {
    const {trace} = revalidationSequence(API, scenario);
    if (['removed','near-wall','partial','off-view'].includes(scenario)) {
      assert.notEqual(trace.at(-1).state, 'occupied'); assert.ok(trace.at(-1).released > 0);
    }
    if (scenario === 'off-view') assert.equal(trace.find(t=>t.time===8750).state, 'free'); // Explicit 1.1.5 restoration, not a relaxed assertion.
    if (['occluded','missing'].includes(scenario)) for (const row of trace) assert.equal(row.state, 'occupied');
    if (scenario === 'partial') for (const row of trace) assert.equal(row.adjacent, 'occupied');
    if (scenario === 'noise') assert.ok(trace.at(-1).occupied > 0);
  });
}
