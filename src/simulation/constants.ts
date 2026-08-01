export const PARTICLE_FLOATS = 12;
export const PARTICLE_STRIDE = PARTICLE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const MAX_PARTICLES = 2048;
export const MAX_TRACERS = 4096;
export const MAX_TRAIL_POINTS = 32;
export const MAX_FIELD_CELLS = 64 * 64;
export const WORKGROUP_SIZE = 64;
export const TWO_PI = 2 * Math.PI;

export const DEFAULTS = {
  domainWidth: 12,
  domainHeight: 8,
  dt: 0.008,
  coreRadius: 0.14,
  uniformFlowX: 0,
  uniformFlowY: 0,
  maxSpeed: 12,
  maxDisplacement: 0.08,
  particleCount: 128,
  tracerCount: 1024,
  trailLength: 20,
} as const;
