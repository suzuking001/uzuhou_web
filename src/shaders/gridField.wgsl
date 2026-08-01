struct GridCell { positive: vec4<f32>, negative: vec4<f32> }
struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}
@group(0) @binding(0) var<storage, read> cells: array<GridCell>;
@group(0) @binding(1) var<storage, read_write> field: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> sim: SimUniforms;
const TWO_PI: f32 = 6.283185307179586;

fn contribution(aggregate: vec4<f32>, position: vec2<f32>) -> vec2<f32> {
  if (abs(aggregate.z) <= 1e-8) { return vec2<f32>(0.0); }
  let delta = position - aggregate.xy;
  let epsilon = max(aggregate.w, 1e-5);
  let coefficient = aggregate.z / (TWO_PI * (dot(delta, delta) + epsilon * epsilon));
  return vec2<f32>(-coefficient * delta.y, coefficient * delta.x);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= sim.fieldWidth || id.y >= sim.fieldHeight) { return; }
  let uv = vec2<f32>(id.xy) / vec2<f32>(f32(sim.fieldWidth), f32(sim.fieldHeight)) + vec2<f32>(0.5 / f32(sim.fieldWidth), 0.5 / f32(sim.fieldHeight));
  let position = (uv - 0.5) * vec2<f32>(sim.domainWidth, sim.domainHeight);
  let resolution = max(sim.displayFlags, 1u);
  var velocity = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);
  for (var i = 0u; i < resolution * resolution; i++) {
    velocity += contribution(cells[i].positive, position) + contribution(cells[i].negative, position);
  }
  if (velocity.x != velocity.x || velocity.y != velocity.y) { velocity = vec2<f32>(0.0); }
  field[id.y * sim.fieldWidth + id.x] = vec4<f32>(position, velocity);
}
