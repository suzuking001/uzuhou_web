import { DEFAULTS, MAX_PARTICLES } from './constants';
import type { PresetId, VortexParticle } from './types';

export interface PresetDefinition {
  id: PresetId;
  label: string;
  description: string;
  create: (count: number, epsilon: number) => VortexParticle[];
}

function vortex(x: number, y: number, gamma: number, epsilon: number): VortexParticle {
  return { x, y, gamma, epsilon, u: 0, v: 0, age: 0, active: true };
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const clampCount = (count: number): number => Math.max(1, Math.min(MAX_PARTICLES, Math.floor(count)));

export const PRESETS: readonly PresetDefinition[] = [
  {
    id: 'co-rotating',
    label: '双子渦',
    description: '同符号・等強度の2渦が中点の周りを回転します。',
    create: (_count, epsilon) => [vortex(-1, 0, 3.2, epsilon), vortex(1, 0, 3.2, epsilon)],
  },
  {
    id: 'dipole',
    label: '並進する渦対',
    description: '逆符号の渦対が間隔を保ちながら並進します。',
    create: (_count, epsilon) => [vortex(-0.65, 0, 3, epsilon), vortex(0.65, 0, -3, epsilon)],
  },
  {
    id: 'street',
    label: 'カルマン風渦列',
    description: '正負の渦を互い違いに並べた周期的な渦列です。',
    create: (count, epsilon) => {
      const n = Math.max(6, Math.min(96, clampCount(count)));
      return Array.from({ length: n }, (_, index) => {
        const row = index % 2;
        const column = Math.floor(index / 2);
        const columns = Math.ceil(n / 2);
        return vortex(-5 + (10 * column) / Math.max(1, columns - 1), row === 0 ? 0.48 : -0.48, row === 0 ? 1.2 : -1.2, epsilon);
      });
    },
  },
  {
    id: 'kelvin-helmholtz',
    label: 'Kelvin–Helmholtz',
    description: '微小擾乱を与えた正負の渦層が巻き上がります。',
    create: (count, epsilon) => {
      const n = Math.max(16, clampCount(count));
      return Array.from({ length: n }, (_, index) => {
        const t = index / n;
        const row = index % 2;
        const x = -5.5 + 11 * t;
        const disturbance = 0.12 * Math.sin(t * Math.PI * 8) + 0.035 * Math.sin(t * Math.PI * 22);
        return vortex(x, (row === 0 ? 0.23 : -0.23) + disturbance, row === 0 ? 0.18 : -0.18, epsilon);
      });
    },
  },
  {
    id: 'random',
    label: 'ランダム渦場',
    description: '総循環をほぼゼロにした再現可能な渦群です。',
    create: (count, epsilon) => {
      const random = mulberry32(0x51a7e);
      const n = clampCount(count);
      const particles = Array.from({ length: n }, (_, index) => {
        const radius = Math.sqrt(random()) * 3.4;
        const angle = random() * Math.PI * 2;
        const gamma = (0.18 + random() * 0.55) * (index % 2 === 0 ? 1 : -1);
        return vortex(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72, gamma, epsilon * (0.8 + random() * 0.5));
      });
      const imbalance = particles.reduce((sum, particle) => sum + particle.gamma, 0) / n;
      particles.forEach((particle) => { particle.gamma -= imbalance; });
      return particles;
    },
  },
  {
    id: 'draw',
    label: 'ユーザー描画',
    description: '空の領域にクリックまたはドラッグして渦を描きます。',
    create: () => [],
  },
] as const;

export function createPreset(id: PresetId, count: number = DEFAULTS.particleCount, epsilon: number = DEFAULTS.coreRadius): VortexParticle[] {
  return (PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]!).create(count, epsilon);
}
