import { WORKGROUP_SIZE } from '../simulation/constants';
import type { SimulationParameters } from '../simulation/types';
import fieldSource from '../shaders/field.wgsl?raw';
import integrateSource from '../shaders/integrate.wgsl?raw';
import tracerSource from '../shaders/tracer.wgsl?raw';
import velocitySource from '../shaders/vortexVelocity.wgsl?raw';
import type { BufferManager } from './BufferManager';

const entries = (items: readonly [number, GPUBuffer][]): GPUBindGroupEntry[] =>
  items.map(([binding, buffer]) => ({ binding, resource: { buffer } }));

export class ComputePipeline {
  private readonly velocityPipeline: GPUComputePipeline;
  private readonly midpointPipeline: GPUComputePipeline;
  private readonly finalPipeline: GPUComputePipeline;
  private readonly tracerPipeline: GPUComputePipeline;
  private readonly fieldPipeline: GPUComputePipeline;

  constructor(private readonly device: GPUDevice, private readonly buffers: BufferManager) {
    this.velocityPipeline = device.createComputePipeline({ label: 'Biot-Savart velocity', layout: 'auto', compute: { module: device.createShaderModule({ code: velocitySource }), entryPoint: 'main' } });
    const integrateModule = device.createShaderModule({ label: 'RK2 integration', code: integrateSource });
    this.midpointPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: integrateModule, entryPoint: 'midpoint' } });
    this.finalPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: integrateModule, entryPoint: 'finalStep' } });
    this.tracerPipeline = device.createComputePipeline({ label: 'passive tracers', layout: 'auto', compute: { module: device.createShaderModule({ code: tracerSource }), entryPoint: 'main' } });
    this.fieldPipeline = device.createComputePipeline({ label: 'sample velocity field', layout: 'auto', compute: { module: device.createShaderModule({ code: fieldSource }), entryPoint: 'main' } });
  }

  encodeStep(pass: GPUComputePassEncoder, particleCount: number, tracerCount: number): void {
    const groups = Math.ceil(particleCount / WORKGROUP_SIZE);
    const velocityInitial = this.device.createBindGroup({
      layout: this.velocityPipeline.getBindGroupLayout(0),
      entries: entries([[0, this.buffers.currentParticles], [1, this.buffers.velocityBuffer], [2, this.buffers.simUniformBuffer]]),
    });
    pass.setPipeline(this.velocityPipeline);
    pass.setBindGroup(0, velocityInitial);
    pass.dispatchWorkgroups(groups);

    const midpoint = this.device.createBindGroup({
      layout: this.midpointPipeline.getBindGroupLayout(0),
      entries: entries([[0, this.buffers.currentParticles], [1, this.buffers.velocityBuffer], [2, this.buffers.midpointBuffer], [3, this.buffers.simUniformBuffer]]),
    });
    pass.setPipeline(this.midpointPipeline);
    pass.setBindGroup(0, midpoint);
    pass.dispatchWorkgroups(groups);

    const velocityMidpoint = this.device.createBindGroup({
      layout: this.velocityPipeline.getBindGroupLayout(0),
      entries: entries([[0, this.buffers.midpointBuffer], [1, this.buffers.velocityBuffer], [2, this.buffers.simUniformBuffer]]),
    });
    pass.setPipeline(this.velocityPipeline);
    pass.setBindGroup(0, velocityMidpoint);
    pass.dispatchWorkgroups(groups);

    const finalStep = this.device.createBindGroup({
      layout: this.finalPipeline.getBindGroupLayout(0),
      entries: entries([[0, this.buffers.currentParticles], [1, this.buffers.velocityBuffer], [2, this.buffers.nextParticles], [3, this.buffers.simUniformBuffer]]),
    });
    pass.setPipeline(this.finalPipeline);
    pass.setBindGroup(0, finalStep);
    pass.dispatchWorkgroups(groups);

    if (tracerCount > 0) {
      const tracers = this.device.createBindGroup({
        layout: this.tracerPipeline.getBindGroupLayout(0),
        entries: entries([[0, this.buffers.nextParticles], [1, this.buffers.currentTracers], [2, this.buffers.nextTracers], [3, this.buffers.trailBuffer], [4, this.buffers.simUniformBuffer]]),
      });
      pass.setPipeline(this.tracerPipeline);
      pass.setBindGroup(0, tracers);
      pass.dispatchWorkgroups(Math.ceil(tracerCount / WORKGROUP_SIZE));
    }
  }

  encodeField(pass: GPUComputePassEncoder, fieldResolution: number, afterStep: boolean): void {
    const source = afterStep ? this.buffers.nextParticles : this.buffers.currentParticles;
    const group = this.device.createBindGroup({
      layout: this.fieldPipeline.getBindGroupLayout(0),
      entries: entries([[0, source], [1, this.buffers.fieldBuffer], [2, this.buffers.simUniformBuffer]]),
    });
    pass.setPipeline(this.fieldPipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(fieldResolution / 8), Math.ceil(fieldResolution / 8));
  }

  finishStep(parameters: SimulationParameters): void {
    this.buffers.swapParticles();
    if (parameters.tracerCount > 0) this.buffers.swapTracers();
  }
}
