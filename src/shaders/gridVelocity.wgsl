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
@group(0) @binding(2) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(3) var<storage, read> memberIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> destinationParticles: array<Particle>;
@group(0) @binding(5) var<uniform> sim: SimUniforms;
const TWO_PI: f32 = 6.283185307179586;
const MAX_PARTICLES: u32 = 2048u;

fn particleCell(position: vec2<f32>, resolution: u32) -> vec2<u32> {
  let domain = max(vec2<f32>(sim.domainWidth, sim.domainHeight), vec2<f32>(1e-5));
  let normalized = clamp(position / domain + 0.5, vec2<f32>(0.0), vec2<f32>(0.999999));
  return vec2<u32>(normalized * f32(resolution));
}

fn aggregateVelocity(aggregate: vec4<f32>, position: vec2<f32>) -> vec2<f32> {
  if (abs(aggregate.z) <= 1e-8) { return vec2<f32>(0.0); }
  let delta = position - aggregate.xy;
  let epsilon = max(aggregate.w, 1e-5);
  let coefficient = aggregate.z / (TWO_PI * (dot(delta, delta) + epsilon * epsilon));
  return vec2<f32>(-coefficient * delta.y, coefficient * delta.x);
}

fn directVelocity(source: Particle, position: vec2<f32>) -> vec2<f32> {
  let delta = position - source.positionGammaCore.xy;
  let epsilon = max(source.positionGammaCore.w, 1e-5);
  let coefficient = source.positionGammaCore.z / (TWO_PI * (dot(delta, delta) + epsilon * epsilon));
  return vec2<f32>(-coefficient * delta.y, coefficient * delta.x);
}

fn isNearCell(cellIndex: u32, focusCell: vec2<u32>, resolution: u32) -> bool {
  let cell = vec2<u32>(cellIndex % resolution, cellIndex / resolution);
  return abs(i32(cell.x) - i32(focusCell.x)) <= 1 && abs(i32(cell.y) - i32(focusCell.y)) <= 1;
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
  let focusCell = particleCell(focus.positionGammaCore.xy, resolution);
  var velocity = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);

  // Far field uses one positive and one negative aggregate per cell.
  for (var cellIndex = 0u; cellIndex < resolution * resolution; cellIndex++) {
    if (isNearCell(cellIndex, focusCell, resolution)) { continue; }
    let cell = cells[cellIndex];
    velocity += aggregateVelocity(cell.positive, focus.positionGammaCore.xy);
    velocity += aggregateVelocity(cell.negative, focus.positionGammaCore.xy);
  }

  // The 3x3 near neighborhood retains exact particle interactions.
  for (var dy: i32 = -1; dy <= 1; dy += 1) {
    let cellY = i32(focusCell.y) + dy;
    if (cellY < 0 || cellY >= i32(resolution)) { continue; }
    for (var dx: i32 = -1; dx <= 1; dx += 1) {
      let cellX = i32(focusCell.x) + dx;
      if (cellX < 0 || cellX >= i32(resolution)) { continue; }
      let cellIndex = u32(cellY) * resolution + u32(cellX);
      let count = cellCounts[cellIndex];
      for (var member = 0u; member < count; member++) {
        let sourceIndex = memberIndices[cellIndex * MAX_PARTICLES + member];
        if (sourceIndex == i) { continue; }
        velocity += directVelocity(sourceParticles[sourceIndex], focus.positionGammaCore.xy);
      }
    }
  }

  result.velocityAgeActive = vec4<f32>(sanitize(velocity), result.velocityAgeActive.zw);
  destinationParticles[i] = result;
}
