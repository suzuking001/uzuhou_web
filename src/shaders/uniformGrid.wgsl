struct Particle { positionGammaCore: vec4<f32>, velocityAgeActive: vec4<f32>, metadata: vec4<f32> }
struct GridCell { positive: vec4<f32>, negative: vec4<f32> }
struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> cells: array<GridCell>;
@group(0) @binding(2) var<uniform> sim: SimUniforms;

fn particleCell(position: vec2<f32>, resolution: u32) -> vec2<u32> {
  let domain = max(vec2<f32>(sim.domainWidth, sim.domainHeight), vec2<f32>(1e-5));
  let normalized = clamp(position / domain + 0.5, vec2<f32>(0.0), vec2<f32>(0.999999));
  return vec2<u32>(normalized * f32(resolution));
}

// One invocation owns a cell. Scanning particles avoids floating-point atomics
// and makes aggregation deterministic on every WebGPU implementation.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let resolution = max(sim.displayFlags, 1u);
  let cellCount = resolution * resolution;
  if (id.x >= cellCount) { return; }
  let targetCell = vec2<u32>(id.x % resolution, id.x / resolution);
  var positivePosition = vec2<f32>(0.0);
  var negativePosition = vec2<f32>(0.0);
  var positiveEpsilon2 = 0.0;
  var negativeEpsilon2 = 0.0;
  var positiveGamma = 0.0;
  var negativeGamma = 0.0;

  for (var i = 0u; i < sim.particleCount; i++) {
    let particle = particles[i];
    let gamma = particle.positionGammaCore.z;
    if (particle.velocityAgeActive.w < 0.5 || gamma == 0.0 || any(particleCell(particle.positionGammaCore.xy, resolution) != targetCell)) { continue; }
    let weight = abs(gamma);
    let epsilon2 = particle.positionGammaCore.w * particle.positionGammaCore.w;
    if (gamma > 0.0) {
      positivePosition += particle.positionGammaCore.xy * weight;
      positiveEpsilon2 += epsilon2 * weight;
      positiveGamma += gamma;
    } else {
      negativePosition += particle.positionGammaCore.xy * weight;
      negativeEpsilon2 += epsilon2 * weight;
      negativeGamma += gamma;
    }
  }

  var cell = GridCell(vec4<f32>(0.0), vec4<f32>(0.0));
  if (positiveGamma > 0.0) {
    cell.positive = vec4<f32>(positivePosition / positiveGamma, positiveGamma, sqrt(positiveEpsilon2 / positiveGamma));
  }
  let negativeWeight = abs(negativeGamma);
  if (negativeWeight > 0.0) {
    cell.negative = vec4<f32>(negativePosition / negativeWeight, negativeGamma, sqrt(negativeEpsilon2 / negativeWeight));
  }
  cells[id.x] = cell;
}
