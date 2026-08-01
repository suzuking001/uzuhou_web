import type { QualityMode, QualitySettings } from '../simulation/types';

const QUALITY: Record<Exclude<QualityMode, 'auto'>, QualitySettings> = {
  low: { tracerLimit: 512, trailLength: 10, fieldResolution: 18, resolutionScale: 0.65, stepsPerFrame: 1 },
  medium: { tracerLimit: 1024, trailLength: 16, fieldResolution: 26, resolutionScale: 0.8, stepsPerFrame: 1 },
  high: { tracerLimit: 2048, trailLength: 24, fieldResolution: 36, resolutionScale: 1, stepsPerFrame: 1 },
  ultra: { tracerLimit: 4096, trailLength: 32, fieldResolution: 52, resolutionScale: 1, stepsPerFrame: 2 },
};

export class QualityManager {
  private automaticLevel: Exclude<QualityMode, 'auto'> = 'high';
  private lastAdjustment = 0;

  resolve(mode: QualityMode, fps: number, now: number): QualitySettings {
    if (mode !== 'auto') return QUALITY[mode];
    if (now - this.lastAdjustment > 2500) {
      const levels: readonly Exclude<QualityMode, 'auto'>[] = ['low', 'medium', 'high', 'ultra'];
      const index = levels.indexOf(this.automaticLevel);
      if (fps > 57 && index < levels.length - 1) {
        this.automaticLevel = levels[index + 1] ?? this.automaticLevel;
        this.lastAdjustment = now;
      } else if (fps > 0 && fps < 42 && index > 0) {
        this.automaticLevel = levels[index - 1] ?? this.automaticLevel;
        this.lastAdjustment = now;
      }
    }
    return QUALITY[this.automaticLevel];
  }

  get automaticLabel(): string { return this.automaticLevel; }
}
