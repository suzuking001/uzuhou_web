import { MAX_FIELD_CELLS, MAX_PARTICLES, MAX_TRACERS, MAX_TRAIL_POINTS, PARTICLE_STRIDE } from '../simulation/constants';
import { packParticles } from '../simulation/layout';
import type { SimulationParameters, VortexParticle } from '../simulation/types';

export const SIM_UNIFORM_BYTES = 64;
export const CAMERA_UNIFORM_BYTES = 64;

export class BufferManager {
  readonly particleBuffers: readonly [GPUBuffer, GPUBuffer];
  readonly velocityBuffer: GPUBuffer;
  readonly midpointBuffer: GPUBuffer;
  readonly tracerBuffers: readonly [GPUBuffer, GPUBuffer];
  readonly trailBuffer: GPUBuffer;
  readonly fieldBuffer: GPUBuffer;
  readonly simUniformBuffer: GPUBuffer;
  readonly cameraUniformBuffer: GPUBuffer;
  particleFront = 0;
  tracerFront = 0;

  constructor(private readonly device: GPUDevice) {
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const particleSize = MAX_PARTICLES * PARTICLE_STRIDE;
    this.particleBuffers = [
      device.createBuffer({ label: 'particles-a', size: particleSize, usage: storage }),
      device.createBuffer({ label: 'particles-b', size: particleSize, usage: storage }),
    ];
    this.velocityBuffer = device.createBuffer({ label: 'velocity-scratch', size: particleSize, usage: storage });
    this.midpointBuffer = device.createBuffer({ label: 'midpoint-scratch', size: particleSize, usage: storage });
    const tracerSize = MAX_TRACERS * 16;
    this.tracerBuffers = [
      device.createBuffer({ label: 'tracers-a', size: tracerSize, usage: storage }),
      device.createBuffer({ label: 'tracers-b', size: tracerSize, usage: storage }),
    ];
    this.trailBuffer = device.createBuffer({ label: 'tracer-history', size: MAX_TRACERS * MAX_TRAIL_POINTS * 16, usage: storage | GPUBufferUsage.COPY_DST });
    this.fieldBuffer = device.createBuffer({ label: 'velocity-field', size: MAX_FIELD_CELLS * 16, usage: storage });
    this.simUniformBuffer = device.createBuffer({ label: 'simulation-uniforms', size: SIM_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cameraUniformBuffer = device.createBuffer({ label: 'camera-uniforms', size: CAMERA_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  get currentParticles(): GPUBuffer { return this.particleBuffers[this.particleFront]!; }
  get nextParticles(): GPUBuffer { return this.particleBuffers[1 - this.particleFront]!; }
  get currentTracers(): GPUBuffer { return this.tracerBuffers[this.tracerFront]!; }
  get nextTracers(): GPUBuffer { return this.tracerBuffers[1 - this.tracerFront]!; }

  swapParticles(): void { this.particleFront = 1 - this.particleFront; }
  swapTracers(): void { this.tracerFront = 1 - this.tracerFront; }

  initializeParticles(particles: readonly VortexParticle[]): void {
    const packed = packParticles(particles);
    this.particleFront = 0;
    this.device.queue.writeBuffer(this.particleBuffers[0], 0, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
    this.device.queue.writeBuffer(this.particleBuffers[1], 0, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
  }

  writeParticle(index: number, particle: VortexParticle): void {
    const packed = packParticles([particle]).subarray(0, 12);
    const offset = index * PARTICLE_STRIDE;
    this.device.queue.writeBuffer(this.currentParticles, offset, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
    this.device.queue.writeBuffer(this.nextParticles, offset, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
  }

  initializeTracers(count: number, width: number, height: number): void {
    const data = new Float32Array(MAX_TRACERS * 4);
    const history = new Float32Array(MAX_TRACERS * MAX_TRAIL_POINTS * 4);
    for (let i = 0; i < Math.min(count, MAX_TRACERS); i++) {
      const u = ((i * 0.61803398875) % 1) - 0.5;
      const v = ((i * 0.754877666) % 1) - 0.5;
      data[i * 4] = u * width;
      data[i * 4 + 1] = v * height;
      data[i * 4 + 2] = (i * 0.37) % 1;
      data[i * 4 + 3] = 1;
      for (let h = 0; h < MAX_TRAIL_POINTS; h++) {
        const offset = (i * MAX_TRAIL_POINTS + h) * 4;
        history[offset] = data[i * 4] ?? 0;
        history[offset + 1] = data[i * 4 + 1] ?? 0;
      }
    }
    this.tracerFront = 0;
    this.device.queue.writeBuffer(this.tracerBuffers[0], 0, data);
    this.device.queue.writeBuffer(this.tracerBuffers[1], 0, data);
    this.device.queue.writeBuffer(this.trailBuffer, 0, history);
  }

  writeSimulationUniforms(parameters: SimulationParameters, activeParticles: number, fieldResolution: number, time: number, trailIndex: number, flags: number): void {
    const buffer = new ArrayBuffer(SIM_UNIFORM_BYTES);
    const u32 = new Uint32Array(buffer);
    const f32 = new Float32Array(buffer);
    u32.set([activeParticles, parameters.tracerCount, ({ wrap: 0, delete: 1, reflect: 2 } as const)[parameters.boundaryMode], trailIndex], 0);
    f32.set([parameters.dt, parameters.domainWidth, parameters.domainHeight, parameters.maxSpeed], 4);
    f32.set([parameters.maxDisplacement, parameters.uniformFlowX, parameters.uniformFlowY, time], 8);
    u32.set([fieldResolution, fieldResolution, parameters.trailLength, flags], 12);
    this.device.queue.writeBuffer(this.simUniformBuffer, 0, buffer);
  }

  destroy(): void {
    [...this.particleBuffers, this.velocityBuffer, this.midpointBuffer, ...this.tracerBuffers, this.trailBuffer, this.fieldBuffer, this.simUniformBuffer, this.cameraUniformBuffer].forEach((buffer) => buffer.destroy());
  }
}
