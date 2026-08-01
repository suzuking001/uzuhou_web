export function saveScreenshot(canvas: HTMLCanvasElement): void {
  const anchor = document.createElement('a');
  anchor.download = `vortex-lab-${new Date().toISOString().replaceAll(':', '-')}.png`;
  anchor.href = canvas.toDataURL('image/png');
  anchor.click();
}
