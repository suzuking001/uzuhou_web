struct Particle { positionGammaCore: vec4<f32>, velocityAgeActive: vec4<f32>, metadata: vec4<f32> }
struct SimUniforms {
  particleCount: u32, tracerCount: u32, boundaryMode: u32, trailIndex: u32,
  dt: f32, domainWidth: f32, domainHeight: f32, maxSpeed: f32,
  maxDisplacement: f32, uniformFlowX: f32, uniformFlowY: f32, time: f32,
  fieldWidth: u32, fieldHeight: u32, trailLength: u32, displayFlags: u32,
}
struct CameraUniforms {
  centerScale: vec4<f32>,
  viewport: vec4<f32>,
  style: vec4<f32>,
  options: vec4<f32>,
}
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> field: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> history: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> camera: CameraUniforms;
@group(0) @binding(4) var<uniform> sim: SimUniforms;
const MAX_HISTORY: u32 = 32u;

fn quadCorner(vertex: u32) -> vec2<f32> {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  return corners[vertex];
}

fn worldToClip(position: vec2<f32>) -> vec2<f32> {
  return (position - camera.centerScale.xy) * camera.centerScale.zw;
}

struct BackgroundOut { @builtin(position) position: vec4<f32>, @location(0) clip: vec2<f32> }
@vertex fn backgroundVertex(@builtin(vertex_index) vertex: u32) -> BackgroundOut {
  let points = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var output: BackgroundOut;
  output.position = vec4<f32>(points[vertex], 0.0, 1.0);
  output.clip = points[vertex];
  return output;
}

@fragment fn backgroundFragment(input: BackgroundOut) -> @location(0) vec4<f32> {
  let world = input.clip / camera.centerScale.zw + camera.centerScale.xy;
  let fine = abs(fract(world + 0.5) - 0.5) / fwidth(world);
  let major = abs(fract(world * 0.2 + 0.5) - 0.5) / fwidth(world * 0.2);
  let fineLine = 1.0 - min(min(fine.x, fine.y), 1.0);
  let majorLine = 1.0 - min(min(major.x, major.y), 1.0);
  let axisDistance = abs(world) / fwidth(world);
  let axis = 1.0 - min(min(axisDistance.x, axisDistance.y), 1.0);
  let gridEnabled = camera.options.x;
  let base = vec3<f32>(0.018, 0.043, 0.064);
  let vignette = 1.0 - 0.22 * smoothstep(0.25, 1.4, length(input.clip));
  let grid = gridEnabled * (fineLine * 0.025 + majorLine * 0.055);
  return vec4<f32>((base + vec3<f32>(grid) + axis * vec3<f32>(0.04, 0.08, 0.10)) * vignette, 1.0);
}

struct ParticleOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) gamma: f32,
  @location(2) enabled: f32,
}
@vertex fn particleVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> ParticleOut {
  let particle = particles[instance];
  let corner = quadCorner(vertex);
  let strength = min(abs(particle.positionGammaCore.z), 5.0);
  let radiusPx = camera.style.x * (0.72 + 0.18 * sqrt(strength));
  let clipOffset = corner * radiusPx * vec2<f32>(2.0 / camera.viewport.x, 2.0 / camera.viewport.y);
  var output: ParticleOut;
  output.position = vec4<f32>(worldToClip(particle.positionGammaCore.xy) + clipOffset, 0.2, 1.0);
  output.local = corner;
  output.gamma = particle.positionGammaCore.z;
  output.enabled = particle.velocityAgeActive.w;
  return output;
}

@fragment fn particleFragment(input: ParticleOut) -> @location(0) vec4<f32> {
  if (input.enabled < 0.5) { discard; }
  let positive = input.gamma >= 0.0;
  let shapeDistance = select(abs(input.local.x) + abs(input.local.y), length(input.local), positive);
  let core = 1.0 - smoothstep(0.42, 0.88, shapeDistance);
  let halo = (1.0 - smoothstep(0.25, 1.0, shapeDistance)) * 0.45;
  let rim = 1.0 - smoothstep(0.02, 0.10, abs(shapeDistance - 0.72));
  let color = select(vec3<f32>(1.0, 0.46, 0.22), vec3<f32>(0.20, 0.82, 1.0), positive);
  let alpha = (core * 0.8 + halo + rim * 0.5) * min(1.0, 0.42 + abs(input.gamma) * 0.22);
  return vec4<f32>(color * (core * 1.35 + halo * 0.7 + rim), alpha);
}

struct FieldOut { @builtin(position) position: vec4<f32>, @location(0) speed: f32, @location(1) local: vec2<f32> }
@vertex fn fieldVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> FieldOut {
  let sample = field[instance];
  let corner = quadCorner(vertex);
  let cell = vec2<f32>(sim.domainWidth / f32(sim.fieldWidth), sim.domainHeight / f32(sim.fieldHeight));
  var output: FieldOut;
  output.position = vec4<f32>(worldToClip(sample.xy + corner * cell * 0.52), 0.8, 1.0);
  output.speed = length(sample.zw);
  output.local = corner;
  return output;
}

fn thermal(value: f32) -> vec3<f32> {
  let t = clamp(value, 0.0, 1.0);
  let a = vec3<f32>(0.015, 0.055, 0.16);
  let b = vec3<f32>(0.0, 0.55, 0.72);
  let c = vec3<f32>(1.0, 0.74, 0.18);
  return select(mix(a, b, t * 2.0), mix(b, c, (t - 0.5) * 2.0), t > 0.5);
}

@fragment fn fieldFragment(input: FieldOut) -> @location(0) vec4<f32> {
  let t = 1.0 - exp(-input.speed * camera.style.z);
  return vec4<f32>(thermal(t), camera.style.w * (0.10 + t * 0.34));
}

struct LineOut { @builtin(position) position: vec4<f32>, @location(0) alpha: f32, @location(1) speed: f32 }
fn lineVertex(start: vec2<f32>, finish: vec2<f32>, widthPx: f32, corner: vec2<f32>, alpha: f32, speed: f32) -> LineOut {
  let direction = normalize(finish - start + vec2<f32>(1e-8, 0.0));
  let normal = vec2<f32>(-direction.y, direction.x);
  let along = (corner.x + 1.0) * 0.5;
  let world = mix(start, finish, along);
  let offset = normal * corner.y * widthPx * vec2<f32>(2.0 / camera.viewport.x, 2.0 / camera.viewport.y);
  var output: LineOut;
  output.position = vec4<f32>(worldToClip(world) + offset, 0.1, 1.0);
  output.alpha = alpha;
  output.speed = speed;
  return output;
}

@vertex fn vectorVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> LineOut {
  let sample = field[instance];
  let speed = length(sample.zw);
  let direction = select(vec2<f32>(0.0), sample.zw / speed, speed > 1e-6);
  let cellWidth = sim.domainWidth / f32(sim.fieldWidth);
  let finish = sample.xy + direction * min(cellWidth * 0.72, speed * camera.style.y);
  return lineVertex(sample.xy, finish, 0.7, quadCorner(vertex), 0.58, speed);
}

@vertex fn trailVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> LineOut {
  let tracer = instance / (MAX_HISTORY - 1u);
  let segment = instance % (MAX_HISTORY - 1u);
  if (tracer >= sim.tracerCount || segment + 1u >= sim.trailLength) {
    return lineVertex(vec2<f32>(1e8), vec2<f32>(1e8), 0.0, quadCorner(vertex), 0.0, 0.0);
  }
  let newest = sim.trailIndex % MAX_HISTORY;
  let aIndex = (newest + MAX_HISTORY - segment) % MAX_HISTORY;
  let bIndex = (newest + MAX_HISTORY - segment - 1u) % MAX_HISTORY;
  let a = history[tracer * MAX_HISTORY + aIndex];
  let b = history[tracer * MAX_HISTORY + bIndex];
  let jump = length(a.xy - b.xy);
  let valid = select(0.0, 1.0, jump < min(sim.domainWidth, sim.domainHeight) * 0.3);
  let fade = valid * (1.0 - f32(segment) / f32(max(sim.trailLength, 2u)));
  return lineVertex(b.xy, a.xy, 0.52, quadCorner(vertex), fade * 0.42, length(a.zw));
}

@fragment fn lineFragment(input: LineOut) -> @location(0) vec4<f32> {
  let tint = mix(vec3<f32>(0.18, 0.72, 0.88), vec3<f32>(0.98, 0.76, 0.32), clamp(input.speed / sim.maxSpeed, 0.0, 1.0));
  return vec4<f32>(tint, input.alpha);
}
