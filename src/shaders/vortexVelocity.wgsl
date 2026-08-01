struct Particle {
  positionGammaCore: vec4<f32>,
  velocityAgeActive: vec4<f32>,
  metadata: vec4<f32>,
}

struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}

@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> destinationParticles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: SimUniforms;

const TWO_PI: f32 = 6.283185307179586;

fn sanitize(raw: vec2<f32>) -> vec2<f32> {
  let fallback = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);
  if (raw.x != raw.x || raw.y != raw.y || abs(raw.x) > 1e19 || abs(raw.y) > 1e19) {
    return fallback;
  }
  let speed = length(raw);
  if (speed > sim.maxSpeed && speed > 0.0) { return raw * (sim.maxSpeed / speed); }
  return raw;
}

// One invocation owns one target particle. Reading source and writing a
// separate buffer prevents a workgroup from observing partially updated state.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.particleCount) { return; }
  let focusParticle = sourceParticles[i];
  var result = focusParticle;
  if (focusParticle.velocityAgeActive.w < 0.5) {
    result.velocityAgeActive = vec4<f32>(0.0, 0.0, result.velocityAgeActive.zw);
    destinationParticles[i] = result;
    return;
  }

  var velocity = vec2<f32>(sim.uniformFlowX, sim.uniformFlowY);
  for (var j = 0u; j < sim.particleCount; j++) {
    let source = sourceParticles[j];
    if (j == i || source.velocityAgeActive.w < 0.5 || source.positionGammaCore.z == 0.0) { continue; }
    let delta = focusParticle.positionGammaCore.xy - source.positionGammaCore.xy;
    let epsilon = max(source.positionGammaCore.w, 1e-5);
    let coefficient = source.positionGammaCore.z / (TWO_PI * (dot(delta, delta) + epsilon * epsilon));
    velocity += vec2<f32>(-coefficient * delta.y, coefficient * delta.x);
  }
  result.velocityAgeActive = vec4<f32>(sanitize(velocity), result.velocityAgeActive.zw);
  destinationParticles[i] = result;
}
