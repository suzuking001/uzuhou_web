export interface VortexParticle {
  x: number;
  y: number;
  gamma: number;
  epsilon: number;
  u: number;
  v: number;
  age: number;
  active: boolean;
}

export type BoundaryMode = 'wrap' | 'delete' | 'reflect';
export type PresetId = 'co-rotating' | 'dipole' | 'street' | 'kelvin-helmholtz' | 'random' | 'draw';
export type DisplayMode = 'combined' | 'vortices' | 'tracers' | 'vectors' | 'heatmap';
export type QualityMode = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface SimulationParameters {
  particleCount: number;
  dt: number;
  simulationSpeed: number;
  coreRadius: number;
  uniformFlowX: number;
  uniformFlowY: number;
  domainWidth: number;
  domainHeight: number;
  maxSpeed: number;
  maxDisplacement: number;
  boundaryMode: BoundaryMode;
  tracerCount: number;
  trailLength: number;
}

export interface PerformanceSnapshot {
  fps: number;
  gpuTimeMs: number | null;
  particleCount: number;
  tracerCount: number;
  interactions: number;
  fieldResolution: number;
  resolutionScale: number;
  workgroupSize: number;
}

export interface QualitySettings {
  tracerLimit: number;
  trailLength: number;
  fieldResolution: number;
  resolutionScale: number;
  stepsPerFrame: number;
}
