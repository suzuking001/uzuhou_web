export class TimestampProfiler {
  private readonly querySet: GPUQuerySet | null;
  private readonly resolveBuffer: GPUBuffer | null;
  private readonly readBuffer: GPUBuffer | null;
  private pending = false;
  private requested = false;
  private frame = 0;
  private latest: number | null = null;
  private latestTag: string | null = null;
  private requestedTag: string | null = null;
  private sampleId = 0;

  constructor(device: GPUDevice, supported: boolean) {
    if (!supported) {
      this.querySet = null;
      this.resolveBuffer = null;
      this.readBuffer = null;
      return;
    }
    this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    this.resolveBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.readBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  beginFrame(tag: string): GPUComputePassDescriptor['timestampWrites'] {
    this.frame += 1;
    this.requested = Boolean(this.querySet && !this.pending && this.frame % 20 === 0);
    if (this.requested) this.requestedTag = tag;
    return this.requested && this.querySet
      ? { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
      : undefined;
  }

  resolve(encoder: GPUCommandEncoder): void {
    if (!this.requested || !this.querySet || !this.resolveBuffer || !this.readBuffer) return;
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16);
    this.pending = true;
  }

  collect(): void {
    if (!this.pending || !this.readBuffer) return;
    void this.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
      const values = new BigUint64Array(this.readBuffer?.getMappedRange().slice(0) ?? new ArrayBuffer(16));
      this.latest = Number((values[1] ?? 0n) - (values[0] ?? 0n)) / 1_000_000;
      this.latestTag = this.requestedTag;
      this.sampleId += 1;
      this.readBuffer?.unmap();
      this.pending = false;
    }).catch(() => { this.pending = false; });
  }

  get latestMs(): number | null { return this.latest; }
  get latestSampleTag(): string | null { return this.latestTag; }
  get latestSampleId(): number { return this.sampleId; }

  destroy(): void {
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    this.readBuffer?.destroy();
  }
}
