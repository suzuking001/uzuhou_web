struct Particle { positionGammaCore: vec4<f32>, velocityAgeActive: vec4<f32>, metadata: vec4<f32> }
struct GridCell { positive: vec4<f32>, negative: vec4<f32> }
struct Tracer { positionSeedActive: vec4<f32> }
struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> cells: array<GridCell>;
@group(0) @binding(2) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(3) var<storage, read> memberIndices: array<u32>;
@group(0) @binding(4) var<storage, read> tracerSource: array<Tracer>;
@group(0) @binding(5) var<storage, read_write> tracerDestination: array<Tracer>;
@group(0) @binding(6) var<storage, read_write> history: array<vec4<f32>>;
@group(0) @binding(7) var<uniform> sim: SimUniforms;
const TWO_PI: f32 = 6.283185307179586;
const MAX_HISTORY: u32 = 32u;
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

fn velocityAt(position: vec2<f32>) -> vec2<f32> {
  let resolution = max(sim.displayFlags, 1u);
  let focusCell = particleCell(position, resolution);
  var velocity = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);

  for (var cellIndex = 0u; cellIndex < resolution * resolution; cellIndex++) {
    if (isNearCell(cellIndex, focusCell, resolution)) { continue; }
    velocity += aggregateVelocity(cells[cellIndex].positive, position);
    velocity += aggregateVelocity(cells[cellIndex].negative, position);
  }

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
        velocity += directVelocity(particles[sourceIndex], position);
      }
    }
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
  var nextPosition = source.positionSeedActive.xy + velocityMid * dt;
  if (any(abs(nextPosition) > vec2<f32>(sim.domainWidth, sim.domainHeight) * 0.5)) { nextPosition = wrapPosition(nextPosition); }
  var next = source;
  next.positionSeedActive = vec4<f32>(nextPosition, source.positionSeedActive.zw);
  tracerDestination[i] = next;
  history[i * MAX_HISTORY + (sim.trailIndex % MAX_HISTORY)] = vec4<f32>(nextPosition, velocityMid);
}
