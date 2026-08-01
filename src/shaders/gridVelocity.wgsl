struct Particle { positionGammaCore: vec4<f32>, velocityAgeActive: vec4<f32>, metadata: vec4<f32> }
struct GridCell { positive: vec4<f32>, negative: vec4<f32> }
struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}
@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read> cells: array<GridCell>;
@group(0) @binding(2) var<storage, read_write> destinationParticles: array<Particle>;
@group(0) @binding(3) var<uniform> sim: SimUniforms;
const TWO_PI: f32 = 6.283185307179586;

fn particleCellIndex(position: vec2<f32>, resolution: u32) -> u32 {
  let domain = max(vec2<f32>(sim.domainWidth, sim.domainHeight), vec2<f32>(1e-5));
  let normalized = clamp(position / domain + 0.5, vec2<f32>(0.0), vec2<f32>(0.999999));
  let cell = vec2<u32>(normalized * f32(resolution));
  return cell.y * resolution + cell.x;
}

fn aggregateVelocity(rawAggregate: vec4<f32>, position: vec2<f32>, focus: Particle, excludeFocus: bool) -> vec2<f32> {
  var aggregate = rawAggregate;
  if (excludeFocus && aggregate.z * focus.positionGammaCore.z > 0.0) {
    let aggregateWeight = abs(aggregate.z);
    let focusWeight = abs(focus.positionGammaCore.z);
    let remainingWeight = aggregateWeight - focusWeight;
    if (remainingWeight <= 1e-6) { return vec2<f32>(0.0); }
    let remainingPosition = (aggregate.xy * aggregateWeight - focus.positionGammaCore.xy * focusWeight) / remainingWeight;
    let epsilon2 = max((aggregate.w * aggregate.w * aggregateWeight - focus.positionGammaCore.w * focus.positionGammaCore.w * focusWeight) / remainingWeight, 1e-10);
    aggregate = vec4<f32>(remainingPosition, aggregate.z - focus.positionGammaCore.z, sqrt(epsilon2));
  }
  if (abs(aggregate.z) <= 1e-8) { return vec2<f32>(0.0); }
  let delta = position - aggregate.xy;
  let epsilon = max(aggregate.w, 1e-5);
  let coefficient = aggregate.z / (TWO_PI * (dot(delta, delta) + epsilon * epsilon));
  return vec2<f32>(-coefficient * delta.y, coefficient * delta.x);
}

fn sanitize(raw: vec2<f32>) -> vec2<f32> {
  let fallback = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);
  if (raw.x != raw.x || raw.y != raw.y || abs(raw.x) > 1e19 || abs(raw.y) > 1e19) { return fallback; }
  let speed = length(raw);
  return select(raw, raw * (sim.maxSpeed / speed), speed > sim.maxSpeed && speed > 0.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.particleCount) { return; }
  let focus = sourceParticles[i];
  var result = focus;
  if (focus.velocityAgeActive.w < 0.5) {
    result.velocityAgeActive = vec4<f32>(0.0, 0.0, result.velocityAgeActive.zw);
    destinationParticles[i] = result;
    return;
  }
  let resolution = max(sim.displayFlags, 1u);
  let focusCell = particleCellIndex(focus.positionGammaCore.xy, resolution);
  var velocity = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);
  for (var cellIndex = 0u; cellIndex < resolution * resolution; cellIndex++) {
    let cell = cells[cellIndex];
    let excludeFocus = cellIndex == focusCell;
    velocity += aggregateVelocity(cell.positive, focus.positionGammaCore.xy, focus, excludeFocus);
    velocity += aggregateVelocity(cell.negative, focus.positionGammaCore.xy, focus, excludeFocus);
  }
  result.velocityAgeActive = vec4<f32>(sanitize(velocity), result.velocityAgeActive.zw);
  destinationParticles[i] = result;
}
