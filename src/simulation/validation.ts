import { circulationWeightedCentroid, stepRK2 } from './cpuReference';
import type { VortexParticle } from './types';

export interface ValidationResult {
  name: string;
  passed: boolean;
  detail: string;
}

const base = { epsilon: 0.12, u: 0, v: 0, age: 0, active: true };
const options = { dt: 0.002, domainWidth: 30, domainHeight: 30, boundaryMode: 'wrap' as const, maxSpeed: 100, maxDisplacement: 1 };

export function runCpuValidation(): ValidationResult[] {
  const single = [{ ...base, x: 0, y: 0, gamma: 2 }];
  const singleAfter = stepRK2(single, options)[0];

  const sameSign = [{ ...base, x: -1, y: 0, gamma: 2 }, { ...base, x: 1, y: 0, gamma: 2 }];
  let rotating: VortexParticle[] = sameSign;
  for (let i = 0; i < 600; i += 1) rotating = stepRK2(rotating, options);
  const centroid = circulationWeightedCentroid(rotating);
  const rotated = Math.abs((rotating[0]?.y ?? 0)) > 0.05;

  const dipoleInitial = [{ ...base, x: -0.6, y: 0, gamma: 2 }, { ...base, x: 0.6, y: 0, gamma: -2 }];
  let dipole: VortexParticle[] = dipoleInitial;
  for (let i = 0; i < 600; i += 1) dipole = stepRK2(dipole, options);
  const initialDistance = 1.2;
  const finalDistance = Math.hypot((dipole[1]?.x ?? 0) - (dipole[0]?.x ?? 0), (dipole[1]?.y ?? 0) - (dipole[0]?.y ?? 0));
  const translation = Math.abs((dipole[0]?.y ?? 0)) > 0.05;

  const source = [{ ...base, x: -1, y: 0, gamma: 0 }, { ...base, x: 1, y: 0, gamma: 1 }];
  const sourceAfter = stepRK2(source, options);

  const symmetric = [
    { ...base, x: -1, y: -1, gamma: 1 }, { ...base, x: 1, y: -1, gamma: 1 },
    { ...base, x: -1, y: 1, gamma: 1 }, { ...base, x: 1, y: 1, gamma: 1 },
  ];
  let symmetricAfter: VortexParticle[] = symmetric;
  for (let i = 0; i < 100; i += 1) symmetricAfter = stepRK2(symmetricAfter, options);
  const symmetryError = Math.abs((symmetricAfter[0]?.x ?? 0) + (symmetricAfter[3]?.x ?? 0)) + Math.abs((symmetricAfter[0]?.y ?? 0) + (symmetricAfter[3]?.y ?? 0));

  return [
    { name: '単一渦の自己誘起速度', passed: Math.hypot(singleAfter?.u ?? 1, singleAfter?.v ?? 1) < 1e-12, detail: `|u|=${Math.hypot(singleAfter?.u ?? 0, singleAfter?.v ?? 0).toExponential(2)}` },
    { name: '同符号2渦の回転と重心', passed: rotated && Math.hypot(...centroid) < 1e-9, detail: `重心誤差=${Math.hypot(...centroid).toExponential(2)}` },
    { name: '逆符号渦対の並進と距離保持', passed: translation && Math.abs(finalDistance - initialDistance) < 1e-5, detail: `距離誤差=${Math.abs(finalDistance - initialDistance).toExponential(2)}` },
    { name: 'ゼロ循環粒子の非寄与', passed: Math.abs(sourceAfter[1]?.u ?? 1) < 1e-12 && Math.abs(sourceAfter[1]?.v ?? 1) < 1e-12, detail: `被誘起速度=${Math.hypot(sourceAfter[1]?.u ?? 0, sourceAfter[1]?.v ?? 0).toExponential(2)}` },
    { name: '対称配置の保存', passed: symmetryError < 1e-9, detail: `対称誤差=${symmetryError.toExponential(2)}` },
  ];
}
