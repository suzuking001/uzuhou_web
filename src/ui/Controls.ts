export function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`UI element not found: ${selector}`);
  return element;
}

export function setRangeOutput(input: HTMLInputElement): void {
  const output = document.querySelector<HTMLOutputElement>(`output[for="${input.id}"]`);
  if (!output) return;
  const suffix = input.dataset.suffix ?? '';
  const decimals = Number(input.dataset.decimals ?? '0');
  output.value = `${Number(input.value).toFixed(decimals)}${suffix}`;
}
