import { WORKGROUP_SIZE } from './constants';
import { computeVelocities } from './cpuReference';
import { packParticles, unpackParticles } from './layout';
import { createPreset } from './presets';
import velocitySource from '../shaders/vortexVelocity.wgsl?raw';

export interface GpuValidationResult { passed: boolean; maximumError: number; tolerance: number }

/** One-shot diagnostic; normal animation never reads particle buffers back. */
export async function compareGpuVelocityWithCpu(device: GPUDevice): Promise<GpuValidationResult> {
  const particles = createPreset('street', 8, 0.16);
  const cpu = computeVelocities(particles, { uniformFlowX: 0.13, uniformFlowY: -0.07, maxSpeed: 30 });
  const packed = packParticles(particles);
  const size = packed.byteLength;
  const input = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const uniforms = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(input, 0, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
  const raw = new ArrayBuffer(64);
  new Uint32Array(raw).set([particles.length, 0, 0, 0], 0);
  new Float32Array(raw).set([0.01, 12, 8, 30], 4);
  new Float32Array(raw).set([1, 0.13, -0.07, 0], 8);
  device.queue.writeBuffer(uniforms, 0, raw);
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: velocitySource }), entryPoint: 'main' } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }, { binding: 2, resource: { buffer: uniforms } },
  ] });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(particles.length / WORKGROUP_SIZE));
  pass.end();
  encoder.copyBufferToBuffer(output, 0, readback, 0, size);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const gpu = unpackParticles(new Float32Array(readback.getMappedRange().slice(0)), particles.length);
  readback.unmap();
  const maximumError = gpu.reduce((max, particle, index) => {
    const reference = cpu[index];
    return Math.max(max, Math.abs(particle.u - (reference?.u ?? 0)), Math.abs(particle.v - (reference?.v ?? 0)));
  }, 0);
  [input, output, readback, uniforms].forEach((buffer) => buffer.destroy());
  const tolerance = 2e-5;
  return { passed: maximumError < tolerance, maximumError, tolerance };
}
