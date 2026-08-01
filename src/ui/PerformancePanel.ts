import type { PerformanceSnapshot } from '../simulation/types';

export class PerformancePanel {
  constructor(private readonly root: HTMLElement) {}

  update(snapshot: PerformanceSnapshot, simulationTime: number): void {
    this.set('metric-time', `${simulationTime.toFixed(2)} s`);
    this.set('metric-fps', snapshot.fps.toFixed(0));
    this.set('metric-gpu', snapshot.gpuTimeMs === null ? '計測待ち' : `${snapshot.gpuTimeMs.toFixed(2)} ms`);
    this.set('metric-particles', snapshot.particleCount.toLocaleString());
    this.set('metric-tracers', snapshot.tracerCount.toLocaleString());
    this.set('metric-interactions', snapshot.interactions.toLocaleString());
    this.set('metric-field', `${snapshot.fieldResolution}²`);
    this.set('metric-render', `${Math.round(snapshot.resolutionScale * 100)}%`);
    this.set('metric-workgroup', String(snapshot.workgroupSize));
  }

  private set(id: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (element) element.textContent = value;
  }
}
