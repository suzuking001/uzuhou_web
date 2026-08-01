export class WebGPUContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly timestampQuerySupported: boolean;

  private constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    timestampQuerySupported: boolean,
  ) {
    this.adapter = adapter;
    this.device = device;
    this.context = context;
    this.format = format;
    this.timestampQuerySupported = timestampQuerySupported;
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGPUContext> {
    if (!navigator.gpu) throw new Error('WebGPU API が利用できません。');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU アダプターを取得できません。');

    const timestampQuerySupported = adapter.features.has('timestamp-query');
    const requiredFeatures: GPUFeatureName[] = timestampQuerySupported ? ['timestamp-query'] : [];
    const device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxStorageBuffersPerShaderStage: Math.min(8, adapter.limits.maxStorageBuffersPerShaderStage),
      },
    });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Canvas の WebGPU コンテキストを取得できません。');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new WebGPUContext(adapter, device, context, format, timestampQuerySupported);
  }

  configure(): void {
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
  }
}
