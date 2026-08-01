import { TWO_PI } from './constants';
import type { BoundaryMode, VortexParticle } from './types';

export interface VelocityOptions {
  uniformFlowX?: number;
  uniformFlowY?: number;
  maxSpeed?: number;
}

export interface StepOptions extends VelocityOptions {
  dt: number;
  domainWidth: number;
  domainHeight: number;
  boundaryMode: BoundaryMode;
  maxDisplacement?: number;
}

const cloneParticle = (particle: VortexParticle): VortexParticle => ({ ...particle });

/**
 * Direct regularized Biot–Savart summation used as a readable f64 reference.
 *
 * u_i = Σ[-Γ_j/(2π) · (y_i-y_j)/(r²+ε_j²)] + Ux
 * v_i = Σ[ Γ_j/(2π) · (x_i-x_j)/(r²+ε_j²)] + Uy
 *
 * The source particle's core radius is used because it regularizes the source
 * vorticity distribution. Inactive and self particles never contribute.
 */
export function computeVelocities(
  particles: readonly VortexParticle[],
  options: VelocityOptions = {},
): VortexParticle[] {
  const uniformFlowX = options.uniformFlowX ?? 0;
  const uniformFlowY = options.uniformFlowY ?? 0;
  const maxSpeed = Math.max(options.maxSpeed ?? Number.POSITIVE_INFINITY, 0);

  return particles.map((target, targetIndex) => {
    const next = cloneParticle(target);
    if (!target.active) {
      next.u = 0;
      next.v = 0;
      return next;
    }

    let u = uniformFlowX;
    let v = uniformFlowY;
    particles.forEach((source, sourceIndex) => {
      if (sourceIndex === targetIndex || !source.active || source.gamma === 0) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const denominator = dx * dx + dy * dy + source.epsilon * source.epsilon;
      if (!Number.isFinite(denominator) || denominator <= Number.EPSILON) return;
      const strength = source.gamma / (TWO_PI * denominator);
      u -= strength * dy;
      v += strength * dx;
    });

    const speed = Math.hypot(u, v);
    if (!Number.isFinite(speed)) {
      u = uniformFlowX;
      v = uniformFlowY;
    } else if (speed > maxSpeed && speed > 0) {
      const scale = maxSpeed / speed;
      u *= scale;
      v *= scale;
    }
    next.u = u;
    next.v = v;
    return next;
  });
}

function applyBoundary(particle: VortexParticle, options: StepOptions): VortexParticle {
  const next = cloneParticle(particle);
  const halfWidth = options.domainWidth * 0.5;
  const halfHeight = options.domainHeight * 0.5;

  if (options.boundaryMode === 'delete') {
    if (Math.abs(next.x) > halfWidth || Math.abs(next.y) > halfHeight) next.active = false;
    return next;
  }

  if (options.boundaryMode === 'wrap') {
    next.x = ((((next.x + halfWidth) % options.domainWidth) + options.domainWidth) % options.domainWidth) - halfWidth;
    next.y = ((((next.y + halfHeight) % options.domainHeight) + options.domainHeight) % options.domainHeight) - halfHeight;
    return next;
  }

  if (next.x > halfWidth || next.x < -halfWidth) {
    next.x = Math.max(-halfWidth, Math.min(halfWidth, next.x));
    next.u *= -1;
  }
  if (next.y > halfHeight || next.y < -halfHeight) {
    next.y = Math.max(-halfHeight, Math.min(halfHeight, next.y));
    next.v *= -1;
  }
  return next;
}

/** Second-order explicit midpoint Runge–Kutta step. */
export function stepRK2(particles: readonly VortexParticle[], options: StepOptions): VortexParticle[] {
  const velocity0 = computeVelocities(particles, options);
  const maximum0 = velocity0.reduce((max, particle) => Math.max(max, Math.hypot(particle.u, particle.v)), 0);
  const displacementLimit = options.maxDisplacement ?? Number.POSITIVE_INFINITY;
  const safeDt = maximum0 > 0 ? Math.min(options.dt, displacementLimit / maximum0) : options.dt;

  const midpoint = particles.map((particle, index) => {
    const velocity = velocity0[index] ?? particle;
    return {
      ...particle,
      x: particle.x + velocity.u * safeDt * 0.5,
      y: particle.y + velocity.v * safeDt * 0.5,
    };
  });
  const midpointVelocity = computeVelocities(midpoint, options);

  return particles.map((particle, index) => {
    const velocity = midpointVelocity[index] ?? particle;
    if (!particle.active) return cloneParticle(particle);
    const next: VortexParticle = {
      ...particle,
      x: particle.x + velocity.u * safeDt,
      y: particle.y + velocity.v * safeDt,
      u: velocity.u,
      v: velocity.v,
      age: particle.age + safeDt,
    };
    return applyBoundary(next, options);
  });
}

export function circulationWeightedCentroid(particles: readonly VortexParticle[]): [number, number] {
  const total = particles.reduce((sum, particle) => sum + Math.abs(particle.gamma), 0);
  if (total <= Number.EPSILON) return [0, 0];
  return [
    particles.reduce((sum, particle) => sum + particle.x * Math.abs(particle.gamma), 0) / total,
    particles.reduce((sum, particle) => sum + particle.y * Math.abs(particle.gamma), 0) / total,
  ];
}
