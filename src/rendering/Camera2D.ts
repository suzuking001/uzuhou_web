export class Camera2D {
  centerX = 0;
  centerY = 0;
  viewHeight = 9;

  fit(domainWidth: number, domainHeight: number, aspect: number): void {
    this.centerX = 0;
    this.centerY = 0;
    this.viewHeight = Math.max(domainHeight * 1.12, (domainWidth * 1.12) / Math.max(aspect, 0.1));
  }

  screenToWorld(clientX: number, clientY: number, rect: DOMRect): [number, number] {
    const aspect = rect.width / Math.max(rect.height, 1);
    return [
      this.centerX + ((clientX - rect.left) / rect.width - 0.5) * this.viewHeight * aspect,
      this.centerY - ((clientY - rect.top) / rect.height - 0.5) * this.viewHeight,
    ];
  }

  panPixels(deltaX: number, deltaY: number, width: number, height: number): void {
    const aspect = width / Math.max(height, 1);
    this.centerX -= (deltaX / width) * this.viewHeight * aspect;
    this.centerY += (deltaY / height) * this.viewHeight;
  }

  zoomAt(factor: number, clientX: number, clientY: number, rect: DOMRect): void {
    const before = this.screenToWorld(clientX, clientY, rect);
    this.viewHeight = Math.max(0.35, Math.min(80, this.viewHeight * factor));
    const after = this.screenToWorld(clientX, clientY, rect);
    this.centerX += before[0] - after[0];
    this.centerY += before[1] - after[1];
  }

  writeUniforms(
    device: GPUDevice,
    buffer: GPUBuffer,
    width: number,
    height: number,
    pointSize: number,
    vectorScale: number,
    heatGain: number,
    heatOpacity: number,
    gridEnabled: boolean,
    time: number,
  ): void {
    const aspect = width / Math.max(height, 1);
    const values = new Float32Array(16);
    values.set([this.centerX, this.centerY, 2 / (this.viewHeight * aspect), 2 / this.viewHeight], 0);
    values.set([width, height, window.devicePixelRatio, time], 4);
    values.set([pointSize, vectorScale, heatGain, heatOpacity], 8);
    values.set([gridEnabled ? 1 : 0, 0, 0, 0], 12);
    device.queue.writeBuffer(buffer, 0, values);
  }
}
