import test from 'node:test';import assert from 'node:assert/strict';import * as API from '../src/collision.js';import {contactCase} from './contact-decomposition.mjs';
for(const id of ['bip','nori','luma'])for(const scale of [.4,.81,1])for(const angle of [0,Math.PI/4])test(`ARP-004J contact decomposition ${id} ${scale} ${angle}`,()=>{
 const r=contactCase(API,{id,scale,angle});assert.equal(r.penetration,0);assert.equal(r.probeSamples,0);assert.ok(r.permitted<r.requested);assert.ok(r.bodyGap>=r.physicalGap);
 assert.ok(Math.abs(r.bodyGap-(r.physicalGap+r.physicalRadius-r.visualSupport))<1e-8);
 assert.equal(r.pointMargin,.025);assert.equal(r.skin,.015);assert.equal(r.cellSize,.12);
 if(angle===0)assert.ok(Math.abs(r.physicalGap-.04)<1e-5);else assert.ok(r.physicalGap>=.04-1e-5);
 console.log('CONTACT_DECOMPOSITION '+JSON.stringify(r));
});
