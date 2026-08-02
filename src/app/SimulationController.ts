import { BufferManager } from '../gpu/BufferManager';
import { ComputePipeline } from '../gpu/ComputePipeline';
import { RenderPipeline } from '../gpu/RenderPipeline';
import { TimestampProfiler } from '../gpu/TimestampProfiler';
import { WebGPUContext } from '../gpu/WebGPUContext';
import { Camera2D } from '../rendering/Camera2D';
import { QualityManager } from '../rendering/QualityManager';
import { MAX_PARTICLES, MAX_TRACERS, WORKGROUP_SIZE } from '../simulation/constants';
import { compareGpuVelocityWithCpu, type GpuValidationResult } from '../simulation/gpuValidation';
import { createPreset } from '../simulation/presets';
import type { AlgorithmMode, DisplayMode, PerformanceSnapshot, PresetId, QualityMode, SimulationParameters, VortexParticle } from '../simulation/types';

export interface ControllerCallbacks {
  onMetrics: (snapshot: PerformanceSnapshot, time: number) => void;
  onError: (message: string) => void;
  onParticleCount: (count: number) => void;
  onGpuValidation: (result: GpuValidationResult) => void;
}

export class SimulationController {
  readonly camera = new Camera2D();
  readonly webgpu: WebGPUContext;
  readonly buffers: BufferManager;
  readonly parameters: SimulationParameters;
  displayMode: DisplayMode = 'combined';
  qualityMode: QualityMode = 'auto';
  algorithmMode: AlgorithmMode = 'direct';
  gridResolution = 8;
  gridEnabled = true;
  playing = true;

  private readonly compute: ComputePipeline;
  private readonly renderer: RenderPipeline;
  private readonly profiler: TimestampProfiler;
  private readonly quality = new QualityManager();
  private readonly callbacks: ControllerCallbacks;
  private preset: PresetId = 'co-rotating';
  private requestedParticleCount: number;
  private activeParticleCount = 0;
  private simulationTime = 0;
  private trailIndex = 0;
  private lastFrame = performance.now();
  private fps = 60;
  private singleStepRequested = false;
  private animationFrame = 0;
  private disposed = false;
  private observedProfilerSample = 0;
  private benchmarkRevision = 0;
  private readonly algorithmTimings: Record<AlgorithmMode, number | null> = { direct: null, 'uniform-grid': null };

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    context: WebGPUContext,
    parameters: SimulationParameters,
    callbacks: ControllerCallbacks,
  ) {
    this.webgpu = context;
    this.parameters = parameters;
    this.callbacks = callbacks;
    this.requestedParticleCount = parameters.particleCount;
    this.buffers = new BufferManager(context.device);
    this.compute = new ComputePipeline(context.device, this.buffers);
    this.renderer = new RenderPipeline(context.device, context.format, this.buffers);
    this.profiler = new TimestampProfiler(context.device, context.timestampQuerySupported);
    context.device.lost.then((info) => callbacks.onError(`GPUデバイスが失われました: ${info.message || info.reason}`)).catch(() => undefined);
  }

  static async create(canvas: HTMLCanvasElement, parameters: SimulationParameters, callbacks: ControllerCallbacks): Promise<SimulationController> {
    const context = await WebGPUContext.create(canvas);
    context.device.pushErrorScope('validation');
    const controller = new SimulationController(canvas, context, parameters, callbacks);
    const error = await context.device.popErrorScope();
    if (error) throw new Error(`GPUパイプライン検証エラー: ${error.message}`);
    controller.reset('co-rotating');
    controller.resize();
    controller.animationFrame = requestAnimationFrame(controller.frame);
    void compareGpuVelocityWithCpu(context.device).then(callbacks.onGpuValidation).catch((error: unknown) => {
      callbacks.onError(`GPU数値比較を実行できませんでした: ${error instanceof Error ? error.message : String(error)}`);
    });
    return controller;
  }

  setPreset(preset: PresetId): void { this.preset = preset; this.reset(preset); }
  setParticleTarget(count: number): void {
    this.requestedParticleCount = Math.max(1, Math.min(MAX_PARTICLES, Math.round(count)));
    this.reset(this.preset);
  }
  togglePlaying(): boolean { this.playing = !this.playing; return this.playing; }
  pause(): void { this.playing = false; }
  stepOnce(): void { this.singleStepRequested = true; }
  setAlgorithmMode(mode: AlgorithmMode): void { this.algorithmMode = mode; }
  setGridResolution(resolution: number): void {
    const next = Math.max(4, Math.min(32, Math.round(resolution)));
    if (next === this.gridResolution) return;
    this.gridResolution = next;
    this.invalidatePerformanceComparison();
  }
  invalidatePerformanceComparison(): void {
    this.benchmarkRevision += 1;
    this.algorithmTimings.direct = null;
    this.algorithmTimings['uniform-grid'] = null;
  }

  reset(preset = this.preset): void {
    this.preset = preset;
    const particles = createPreset(preset, this.requestedParticleCount, this.parameters.coreRadius);
    this.activeParticleCount = particles.length;
    this.parameters.particleCount = particles.length;
    this.simulationTime = 0;
    this.trailIndex = 0;
    this.invalidatePerformanceComparison();
    this.buffers.initializeParticles(particles);
    this.buffers.initializeTracers(this.parameters.tracerCount, this.parameters.domainWidth, this.parameters.domainHeight);
    this.callbacks.onParticleCount(particles.length);
  }

  resetView(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.camera.fit(this.parameters.domainWidth, this.parameters.domainHeight, rect.width / Math.max(rect.height, 1));
  }

  resetTracers(): void {
    this.buffers.initializeTracers(this.parameters.tracerCount, this.parameters.domainWidth, this.parameters.domainHeight);
    this.trailIndex = 0;
  }

  addVortex(x: number, y: number, sign: 1 | -1): boolean {
    if (this.activeParticleCount >= MAX_PARTICLES) return false;
    const particle: VortexParticle = {
      x, y, gamma: sign * 1.5, epsilon: this.parameters.coreRadius,
      u: 0, v: 0, age: 0, active: true,
    };
    this.buffers.writeParticle(this.activeParticleCount, particle);
    this.activeParticleCount += 1;
    this.invalidatePerformanceComparison();
    this.parameters.particleCount = this.activeParticleCount;
    this.callbacks.onParticleCount(this.activeParticleCount);
    return true;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const settings = this.quality.resolve(this.qualityMode, this.fps, performance.now());
    const maximum = this.webgpu.device.limits.maxTextureDimension2D;
    const width = Math.min(maximum, Math.max(1, Math.floor(rect.width * devicePixelRatio * settings.resolutionScale)));
    const height = Math.min(maximum, Math.max(1, Math.floor(rect.height * devicePixelRatio * settings.resolutionScale)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.webgpu.configure();
    }
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const elapsed = Math.max(1, now - this.lastFrame);
    this.lastFrame = now;
    this.fps += ((1000 / elapsed) - this.fps) * 0.08;
    this.resize();
    const settings = this.quality.resolve(this.qualityMode, this.fps, now);
    const effectiveTracerCount = Math.min(this.parameters.tracerCount, settings.tracerLimit, MAX_TRACERS);
    const effectiveTrailLength = Math.min(this.parameters.trailLength, settings.trailLength);
    const shouldAdvance = this.playing || this.singleStepRequested;
    const steps = shouldAdvance ? (this.singleStepRequested ? 1 : settings.stepsPerFrame) : 0;
    this.singleStepRequested = false;

    for (let step = 0; step < steps; step++) {
      const effectiveParameters = {
        ...this.parameters,
        dt: (this.parameters.dt * this.parameters.simulationSpeed) / steps,
        tracerCount: effectiveTracerCount,
        trailLength: effectiveTrailLength,
      };
      this.trailIndex = (this.trailIndex + 1) % 4_294_967_295;
      this.buffers.writeSimulationUniforms(effectiveParameters, this.activeParticleCount, settings.fieldResolution, this.simulationTime, this.trailIndex, this.gridResolution);
      const encoder = this.webgpu.device.createCommandEncoder({ label: 'RK2 simulation step' });
      const pass = encoder.beginComputePass({ timestampWrites: this.profiler.beginFrame(`${this.algorithmMode}:${this.benchmarkRevision}`) });
      this.compute.encodeStep(pass, this.activeParticleCount, effectiveTracerCount, this.algorithmMode, this.gridResolution);
      pass.end();
      this.profiler.resolve(encoder);
      this.webgpu.device.queue.submit([encoder.finish()]);
      this.compute.finishStep(effectiveParameters);
      this.profiler.collect();
      this.simulationTime += effectiveParameters.dt;
    }

    const renderParameters = { ...this.parameters, tracerCount: effectiveTracerCount, trailLength: effectiveTrailLength };
    this.captureProfilerSample();
    this.buffers.writeSimulationUniforms(renderParameters, this.activeParticleCount, settings.fieldResolution, this.simulationTime, this.trailIndex, this.gridResolution);
    this.camera.writeUniforms(this.webgpu.device, this.buffers.cameraUniformBuffer, this.canvas.width, this.canvas.height, 8.5 * devicePixelRatio * settings.resolutionScale, 0.08, 0.75, 0.72, this.gridEnabled, this.simulationTime);
    const encoder = this.webgpu.device.createCommandEncoder({ label: 'field and rendering' });
    const fieldPass = encoder.beginComputePass();
    this.compute.encodeField(fieldPass, settings.fieldResolution, false, this.algorithmMode, this.gridResolution);
    fieldPass.end();
    this.renderer.encode(encoder, this.webgpu.context.getCurrentTexture().createView(), this.displayMode, this.activeParticleCount, effectiveTracerCount, settings.fieldResolution);
    this.webgpu.device.queue.submit([encoder.finish()]);

    const directGpuTimeMs = this.algorithmTimings.direct;
    const gridGpuTimeMs = this.algorithmTimings['uniform-grid'];
    const gridCellCount = this.gridResolution * this.gridResolution;
    const nearCellCount = Math.min(9, gridCellCount);
    const estimatedNearParticles = Math.min(this.activeParticleCount, Math.ceil(this.activeParticleCount * nearCellCount / gridCellCount));
    const hybridSources = estimatedNearParticles + Math.max(0, gridCellCount - nearCellCount) * 2;
    this.callbacks.onMetrics({
      fps: this.fps, gpuTimeMs: this.algorithmTimings[this.algorithmMode], particleCount: this.activeParticleCount,
      tracerCount: effectiveTracerCount,
      interactions: this.algorithmMode === 'direct'
        ? this.activeParticleCount * Math.max(0, this.activeParticleCount - 1)
        : this.activeParticleCount * hybridSources,
      fieldResolution: settings.fieldResolution, resolutionScale: settings.resolutionScale, workgroupSize: WORKGROUP_SIZE,
      algorithmMode: this.algorithmMode, gridResolution: this.gridResolution,
      evaluatedSources: this.algorithmMode === 'direct' ? this.activeParticleCount : hybridSources,
      directGpuTimeMs, gridGpuTimeMs,
      speedup: directGpuTimeMs !== null && gridGpuTimeMs !== null && gridGpuTimeMs > 0 ? directGpuTimeMs / gridGpuTimeMs : null,
    }, this.simulationTime);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private captureProfilerSample(): void {
    if (this.profiler.latestSampleId === this.observedProfilerSample) return;
    this.observedProfilerSample = this.profiler.latestSampleId;
    const tag = this.profiler.latestSampleTag;
    const sample = this.profiler.latestMs;
    const match = tag?.match(/^(direct|uniform-grid):(\d+)$/);
    if (!match || Number(match[2]) !== this.benchmarkRevision || sample === null) return;
    const mode = match[1] as AlgorithmMode;
    const previous = this.algorithmTimings[mode];
    this.algorithmTimings[mode] = previous === null ? sample : previous * 0.7 + sample * 0.3;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.profiler.destroy();
    this.buffers.destroy();
    this.webgpu.device.destroy();
  }
}
