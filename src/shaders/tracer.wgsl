struct Particle { positionGammaCore: vec4<f32>, velocityAgeActive: vec4<f32>, metadata: vec4<f32> }
struct Tracer { positionSeedActive: vec4<f32> }
struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}
@group(0) @binding(0) var<storage, read> vortices: array<Particle>;
@group(0) @binding(1) var<storage, read> tracerSource: array<Tracer>;
@group(0) @binding(2) var<storage, read_write> tracerDestination: array<Tracer>;
@group(0) @binding(3) var<storage, read_write> history: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> sim: SimUniforms;
const TWO_PI: f32 = 6.283185307179586;
const MAX_HISTORY: u32 = 32u;

fn velocityAt(position: vec2<f32>) -> vec2<f32> {
  var velocity = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);
  for (var j = 0u; j < sim.particleCount; j++) {
    let source = vortices[j];
    if (source.velocityAgeActive.w < 0.5 || source.positionGammaCore.z == 0.0) { continue; }
    let delta = position - source.positionGammaCore.xy;
    let epsilon = max(source.positionGammaCore.w, 1e-5);
    let coefficient = source.positionGammaCore.z / (TWO_PI * (dot(delta, delta) + epsilon * epsilon));
    velocity += vec2<f32>(-coefficient * delta.y, coefficient * delta.x);
  }
  if (velocity.x != velocity.x || velocity.y != velocity.y) { return vec2<f32>(0.0); }
  let speed = length(velocity);
  return select(velocity, velocity * (sim.maxSpeed / speed), speed > sim.maxSpeed);
}

fn wrapPosition(position: vec2<f32>) -> vec2<f32> {
  let size = vec2<f32>(sim.domainWidth, sim.domainHeight);
  return position - size * floor((position + size * 0.5) / size);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.tracerCount) { return; }
  let source = tracerSource[i];
  let velocity0 = velocityAt(source.positionSeedActive.xy);
  let speed = length(velocity0);
  let dt = select(sim.dt, min(sim.dt, sim.maxDisplacement / speed), speed > 1e-8);
  let midpoint = source.positionSeedActive.xy + velocity0 * dt * 0.5;
  let velocityMid = velocityAt(midpoint);
  var next = source;
  var nextPosition = source.positionSeedActive.xy + velocityMid * dt;
  if (any(abs(nextPosition) > vec2<f32>(sim.domainWidth, sim.domainHeight) * 0.5)) {
    // Passive tracers recycle to maintain a statistically steady seeding density.
    nextPosition = wrapPosition(nextPosition);
  }
  next.positionSeedActive = vec4<f32>(nextPosition, source.positionSeedActive.zw);
  tracerDestination[i] = next;
  history[i * MAX_HISTORY + (sim.trailIndex % MAX_HISTORY)] = vec4<f32>(next.positionSeedActive.xy, velocityMid);
}
