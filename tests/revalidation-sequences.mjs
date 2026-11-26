// Same derived geometry/depth and temporal votes for all historical implementations.
export function revalidationSequence(API, scenario) {
  const map = new API.SpatialMap(); map.clear([0, 0, 0]);
  const x = scenario === 'off-view' ? 1.18 : .02;
  for (let t = 0; t <= 2000; t += 125) {
    map.begin(t, [0, 0, 0], 1); map.observe(x, .3, -1.2);
    if (scenario === 'partial') map.observe(.14, .3, -1.2);
  }
  const data = new Uint16Array(160*90).fill(scenario === 'occluded' ? 600 : scenario === 'near-wall' ? 1290 : scenario === 'missing' ? 0 : 3000);
  if (scenario === 'partial') for (let y = 0; y < 90; y++) for (let a = 0; a < 160; a++)
    if ((2*(a+.5)/160-1)*1.2 > .08) data[y*160+a] = 1200;
  if (scenario === 'noise') for (let i = 0; i < data.length; i++) if (i%3 === 0) data[i] = 1200;
  const info = {width:160,height:90,rawValueToMeters:.001,data:data.buffer,normDepthBufferFromNormView:{matrix:API.I()}};
  const projection = API.perspective(Math.PI/2, 1), projector = new API.DepthProjector(), validator = new API.SpatialRevalidator(() => 0);
  const trace = [];
  for (let t = 8000; t <= 10500; t += 250) {
    const view = {projectionMatrix:projection,transform:{matrix:API.tr(scenario === 'off-view' && t >= 9500 ? .4 : 0, .35, 0)}};
    projector.configure(info, view); map.begin(t, [0, 0, 0], 1);
    validator.update(t, API.createDepthReader(info, 'luminance-alpha'), projector, projection, map, [0,0,0], {radius:.2,height:.7,ground:0}, 0, -.55);
    trace.push({time:t, state:map.stateAt(x,.3,-1.2,t), adjacent:scenario === 'partial' ? map.stateAt(.14,.3,-1.2,t) : null, released:map.releasedCount, occupied:map.occupiedCount});
  }
  return {scenario, trace};
}
