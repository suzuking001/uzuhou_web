import { MAX_TRAIL_POINTS } from '../simulation/constants';
import type { DisplayMode } from '../simulation/types';
import renderSource from '../shaders/render.wgsl?raw';
import type { BufferManager } from './BufferManager';

export class RenderPipeline {
  private readonly layout: GPUBindGroupLayout;
  private readonly background: GPURenderPipeline;
  private readonly particles: GPURenderPipeline;
  private readonly field: GPURenderPipeline;
  private readonly vectors: GPURenderPipeline;
  private readonly trails: GPURenderPipeline;

  constructor(private readonly device: GPUDevice, format: GPUTextureFormat, private readonly buffers: BufferManager) {
    const module = device.createShaderModule({ label: 'scientific rendering', code: renderSource });
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const make = (label: string, vertex: string, fragment: string, blending: boolean): GPURenderPipeline => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [{ format, blend: blending ? blend : undefined }] },
      primitive: { topology: 'triangle-list' },
    });
    this.background = make('grid background', 'backgroundVertex', 'backgroundFragment', false);
    this.particles = make('vortex glyphs', 'particleVertex', 'particleFragment', true);
    this.field = make('velocity heatmap', 'fieldVertex', 'fieldFragment', true);
    this.vectors = make('velocity vectors', 'vectorVertex', 'lineFragment', true);
    this.trails = make('tracer trails', 'trailVertex', 'lineFragment', true);
  }

  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    mode: DisplayMode,
    particleCount: number,
    tracerCount: number,
    fieldResolution: number,
  ): void {
    const bindGroup = this.device.createBindGroup({ layout: this.layout, entries: [
      { binding: 0, resource: { buffer: this.buffers.currentParticles } },
      { binding: 1, resource: { buffer: this.buffers.fieldBuffer } },
      { binding: 2, resource: { buffer: this.buffers.trailBuffer } },
      { binding: 3, resource: { buffer: this.buffers.cameraUniformBuffer } },
      { binding: 4, resource: { buffer: this.buffers.simUniformBuffer } },
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.01, g: 0.025, b: 0.04, a: 1 } }] });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(this.background);
    pass.draw(3);
    if (mode === 'heatmap' || mode === 'combined') {
      pass.setPipeline(this.field);
      pass.draw(6, fieldResolution * fieldResolution);
    }
    if (mode === 'tracers' || mode === 'combined') {
      pass.setPipeline(this.trails);
      pass.draw(6, tracerCount * (MAX_TRAIL_POINTS - 1));
    }
    if (mode === 'vectors' || mode === 'combined') {
      pass.setPipeline(this.vectors);
      pass.draw(6, fieldResolution * fieldResolution);
    }
    if (mode === 'vortices' || mode === 'combined') {
      pass.setPipeline(this.particles);
      pass.draw(6, particleCount);
    }
    pass.end();
  }
}
