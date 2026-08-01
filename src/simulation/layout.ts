import { MAX_PARTICLES, PARTICLE_FLOATS } from './constants';
import type { VortexParticle } from './types';

/**
 * Particle layout shared with WGSL (48-byte stride):
 * vec4 positionGammaCore = [x, y, circulation, core radius]
 * vec4 velocityAgeActive = [u, v, age, active as 0/1]
 * vec4 metadata          = reserved for future boundary/body coupling.
 */
export function packParticles(particles: readonly VortexParticle[]): Float32Array {
  if (particles.length > MAX_PARTICLES) {
    throw new RangeError(`Particle count exceeds ${MAX_PARTICLES}`);
  }
  const packed = new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS);
  particles.forEach((particle, index) => {
    const offset = index * PARTICLE_FLOATS;
    packed[offset] = particle.x;
    packed[offset + 1] = particle.y;
    packed[offset + 2] = particle.gamma;
    packed[offset + 3] = particle.epsilon;
    packed[offset + 4] = particle.u;
    packed[offset + 5] = particle.v;
    packed[offset + 6] = particle.age;
    packed[offset + 7] = particle.active ? 1 : 0;
  });
  return packed;
}

export function unpackParticles(data: Float32Array, count: number): VortexParticle[] {
  const safeCount = Math.min(count, Math.floor(data.length / PARTICLE_FLOATS));
  return Array.from({ length: safeCount }, (_, index) => {
    const offset = index * PARTICLE_FLOATS;
    return {
      x: data[offset] ?? 0,
      y: data[offset + 1] ?? 0,
      gamma: data[offset + 2] ?? 0,
      epsilon: data[offset + 3] ?? 0,
      u: data[offset + 4] ?? 0,
      v: data[offset + 5] ?? 0,
      age: data[offset + 6] ?? 0,
      active: (data[offset + 7] ?? 0) > 0.5,
    };
  });
}
