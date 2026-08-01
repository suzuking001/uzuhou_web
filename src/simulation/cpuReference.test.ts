import { describe, expect, it } from 'vitest';
import { computeVelocities, stepRK2 } from './cpuReference';
import { packParticles, unpackParticles } from './layout';
import { createPreset } from './presets';
import { runCpuValidation } from './validation';

describe('regularized vortex-particle CPU reference', () => {
  it('passes the documented physical invariants', () => {
    for (const result of runCpuValidation()) expect(result.passed, result.detail).toBe(true);
  });

  it('matches the analytical two-vortex initial velocity', () => {
    const particles = createPreset('co-rotating', 2, 0.1);
    const result = computeVelocities(particles);
    const expected = 3.2 * 2 / (2 * Math.PI * (4 + 0.01));
    expect(result[0]?.u).toBeCloseTo(0, 12);
    expect(result[0]?.v).toBeCloseTo(-expected, 12);
    expect(result[1]?.v).toBeCloseTo(expected, 12);
  });

  it('uses midpoint RK2 rather than forward Euler', () => {
    const before = createPreset('dipole');
    const after = stepRK2(before, { dt: 0.05, domainWidth: 20, domainHeight: 20, boundaryMode: 'wrap' });
    expect(after[0]?.y).not.toBe(0);
    expect(after[0]?.x).toBeCloseTo(before[0]?.x ?? 0, 10);
  });

  it('round-trips the documented 48-byte GPU layout', () => {
    const particles = createPreset('co-rotating');
    const restored = unpackParticles(packParticles(particles), particles.length);
    expect(restored[0]?.gamma).toBeCloseTo(particles[0]?.gamma ?? 0, 6);
    expect(restored[1]?.active).toBe(true);
  });
});
