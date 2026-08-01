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

@group(0) @binding(0) var<storage, read> originalParticles: array<Particle>;
@group(0) @binding(1) var<storage, read> evaluatedParticles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> destinationParticles: array<Particle>;
@group(0) @binding(3) var<uniform> sim: SimUniforms;

fn effectiveDt(velocity: vec2<f32>) -> f32 {
  let speed = length(velocity);
  return select(sim.dt, min(sim.dt, sim.maxDisplacement / speed), speed > 1e-8);
}

@compute @workgroup_size(64)
fn midpoint(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.particleCount) { return; }
  let original = originalParticles[i];
  var result = evaluatedParticles[i];
  if (original.velocityAgeActive.w > 0.5) {
    let dt = effectiveDt(result.velocityAgeActive.xy);
    result.positionGammaCore = vec4<f32>(original.positionGammaCore.xy + 0.5 * dt * result.velocityAgeActive.xy, result.positionGammaCore.zw);
  }
  destinationParticles[i] = result;
}

fn wrapCoordinate(value: f32, halfExtent: f32) -> f32 {
  let width = 2.0 * halfExtent;
  return value - width * floor((value + halfExtent) / width);
}

@compute @workgroup_size(64)
fn finalStep(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.particleCount) { return; }
  let original = originalParticles[i];
  let evaluated = evaluatedParticles[i];
  var result = original;
  if (original.velocityAgeActive.w < 0.5) { destinationParticles[i] = result; return; }

  let dt = effectiveDt(evaluated.velocityAgeActive.xy);
  var positionGammaCore = vec4<f32>(original.positionGammaCore.xy + dt * evaluated.velocityAgeActive.xy, original.positionGammaCore.zw);
  var velocityAgeActive = vec4<f32>(evaluated.velocityAgeActive.xy, original.velocityAgeActive.z + dt, original.velocityAgeActive.w);
  let halfExtent = vec2<f32>(sim.domainWidth, sim.domainHeight) * 0.5;

  if (sim.boundaryMode == 0u) {
    positionGammaCore.x = wrapCoordinate(positionGammaCore.x, halfExtent.x);
    positionGammaCore.y = wrapCoordinate(positionGammaCore.y, halfExtent.y);
  } else if (sim.boundaryMode == 1u) {
    if (any(abs(positionGammaCore.xy) > halfExtent)) { velocityAgeActive.w = 0.0; }
  } else {
    if (abs(positionGammaCore.x) > halfExtent.x) {
      positionGammaCore.x = clamp(positionGammaCore.x, -halfExtent.x, halfExtent.x);
      velocityAgeActive.x *= -1.0;
    }
    if (abs(positionGammaCore.y) > halfExtent.y) {
      positionGammaCore.y = clamp(positionGammaCore.y, -halfExtent.y, halfExtent.y);
      velocityAgeActive.y *= -1.0;
    }
  }
  if (any(positionGammaCore.xy != positionGammaCore.xy)) { velocityAgeActive.w = 0.0; }
  result.positionGammaCore = positionGammaCore;
  result.velocityAgeActive = velocityAgeActive;
  destinationParticles[i] = result;
}
