import { saveScreenshot } from '../rendering/Screenshot';
import { DEFAULTS, MAX_PARTICLES, MAX_TRACERS } from '../simulation/constants';
import { PRESETS } from '../simulation/presets';
import type { BoundaryMode, DisplayMode, PresetId, QualityMode, SimulationParameters } from '../simulation/types';
import { runCpuValidation } from '../simulation/validation';
import { requiredElement, setRangeOutput } from '../ui/Controls';
import { PerformancePanel } from '../ui/PerformancePanel';
import { SimulationController } from './SimulationController';

const range = (id: string, label: string, min: number, max: number, step: number, value: number, suffix = '', decimals = 0): string => `
  <label class="control range-control" for="${id}">
    <span>${label}<output for="${id}">${value.toFixed(decimals)}${suffix}</output></span>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-suffix="${suffix}" data-decimals="${decimals}" />
  </label>`;

export class App {
  private controller: SimulationController | null = null;
  private parameters: SimulationParameters = {
    particleCount: DEFAULTS.particleCount,
    dt: DEFAULTS.dt,
    simulationSpeed: 1,
    coreRadius: DEFAULTS.coreRadius,
    uniformFlowX: DEFAULTS.uniformFlowX,
    uniformFlowY: DEFAULTS.uniformFlowY,
    domainWidth: DEFAULTS.domainWidth,
    domainHeight: DEFAULTS.domainHeight,
    maxSpeed: DEFAULTS.maxSpeed,
    maxDisplacement: DEFAULTS.maxDisplacement,
    boundaryMode: 'wrap',
    tracerCount: DEFAULTS.tracerCount,
    trailLength: DEFAULTS.trailLength,
  };
  private vortexSign: 1 | -1 = 1;
  private lastMetricPaint = 0;

  constructor(private readonly root: HTMLElement) {}

  async mount(): Promise<void> {
    this.root.innerHTML = this.template();
    this.bindCommonControls();
    this.showCpuValidation();

    if (!navigator.gpu) {
      this.showUnsupported();
      return;
    }

    const canvas = requiredElement<HTMLCanvasElement>(this.root, '#simulation-canvas');
    const performancePanel = new PerformancePanel(this.root);
    try {
      this.controller = await SimulationController.create(canvas, this.parameters, {
        onMetrics: (snapshot, time) => {
          const now = performance.now();
          if (now - this.lastMetricPaint > 180) {
            performancePanel.update(snapshot, time);
            this.lastMetricPaint = now;
          }
        },
        onError: (message) => this.showError(message),
        onParticleCount: (count) => {
          const metric = this.root.querySelector('#metric-particles');
          if (metric) metric.textContent = count.toLocaleString();
          const badge = this.root.querySelector('#top-particles');
          if (badge) badge.textContent = count.toLocaleString();
        },
        onGpuValidation: (result) => {
          const target = requiredElement<HTMLElement>(this.root, '#gpu-validation');
          target.className = `validation-row ${result.passed ? 'passed' : 'failed'}`;
          target.innerHTML = `<span>${result.passed ? '✓' : '!'}</span><div><strong>GPU ↔ CPU f32比較</strong><small>最大誤差 ${result.maximumError.toExponential(2)} / 許容 ${result.tolerance.toExponential(1)}</small></div>`;
        },
      });
      this.parameters = this.controller.parameters;
      this.controller.resetView();
      this.bindSimulationControls(canvas);
      this.setGpuStatus(true, this.controller.webgpu.timestampQuerySupported);
    } catch (error) {
      this.showUnsupported(error instanceof Error ? error.message : String(error));
    }
  }

  private template(): string {
    const presetButtons = PRESETS.map((preset, index) => `
      <button class="preset-card ${index === 0 ? 'active' : ''}" data-preset="${preset.id}" title="${preset.description}">
        <span class="preset-icon">${['↻', '↑', '≈', '≋', '✦', '✎'][index]}</span>
        <span><strong>${preset.label}</strong><small>${preset.description}</small></span>
      </button>`).join('');
    return `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand"><span class="brand-mark">V</span><div><strong>Vortex Lab</strong><small>WEBGPU · 2D CFD</small></div></div>
          <div class="top-metrics" aria-label="simulation status">
            <span><i></i> LIVE</span><span>t <b id="metric-time">0.00 s</b></span><span>FPS <b id="metric-fps">—</b></span><span>N <b id="top-particles">2</b></span>
          </div>
          <div id="gpu-chip" class="gpu-chip pending"><span></span>GPU 初期化中</div>
        </header>

        <main class="workspace">
          <section class="canvas-stage" aria-label="流体解析キャンバス">
            <canvas id="simulation-canvas" aria-label="2次元渦法シミュレーション"></canvas>
            <div class="canvas-glow" aria-hidden="true"></div>
            <div class="floating-toolbar">
              <button id="play-button" class="primary-button" title="再生・一時停止"><span>Ⅱ</span><em>一時停止</em></button>
              <button id="step-button" title="1ステップ実行">›|</button>
              <button id="reset-button" title="初期状態へ戻す">↺</button>
              <span class="tool-divider"></span>
              <button id="fit-button" title="全体表示">⊡</button>
              <button id="screenshot-button" title="PNGを保存">⌁</button>
              <button id="drawer-button" class="mobile-only" title="設定を開く">☰</button>
            </div>
            <div class="interaction-hint"><span class="mouse-icon">＋</span> ドラッグで渦を描く <i></i> ホイールでズーム <i></i> 右ドラッグでパン</div>
            <div id="error-banner" class="error-banner" hidden></div>
            <div id="unsupported" class="unsupported" hidden>
              <div class="unsupported-card">
                <span class="unsupported-icon">GPU</span>
                <h2>WebGPUを開始できません</h2>
                <p id="unsupported-reason">このブラウザーではWebGPUを利用できません。</p>
                <ul><li>Chrome / Edge などWebGPU対応ブラウザーを使用</li><li>HTTPS または localhost でアクセス</li><li>GPUドライバーとブラウザーを更新</li><li>ソフトウェアGPUでは十分な性能が出ない場合があります</li></ul>
              </div>
            </div>
          </section>

          <aside id="control-panel" class="control-panel">
            <div class="panel-head"><div><span>CONTROL DECK</span><h2>Flow parameters</h2></div><button id="close-drawer" class="mobile-only">×</button></div>
            <div class="panel-scroll">
              <section class="panel-section presets"><h3><span>01</span> 初期条件</h3><div class="preset-grid">${presetButtons}</div></section>
              <section class="panel-section"><h3><span>02</span> 数値パラメーター</h3>
                ${range('particle-count', '粒子数', 2, MAX_PARTICLES, 2, DEFAULTS.particleCount)}
                ${range('time-step', '時間刻み dt', 0.001, 0.03, 0.001, DEFAULTS.dt, '', 3)}
                ${range('sim-speed', 'シミュレーション速度', 0.1, 3, 0.1, 1, '×', 1)}
                ${range('core-radius', 'コア半径 ε', 0.03, 0.5, 0.01, DEFAULTS.coreRadius, '', 2)}
                <div class="split-controls">${range('flow-x', '一様流 Ux', -2, 2, 0.05, 0, '', 2)}${range('flow-y', '一様流 Uy', -2, 2, 0.05, 0, '', 2)}</div>
                <div class="split-controls">${range('domain-width', '領域幅', 4, 30, 1, DEFAULTS.domainWidth)}${range('domain-height', '領域高', 4, 24, 1, DEFAULTS.domainHeight)}</div>
                <label class="control"><span>画面外粒子</span><select id="boundary-mode"><option value="wrap">ラップ</option><option value="delete">削除</option><option value="reflect">反射</option></select></label>
                <p class="stability-note"><span>STABLE</span> 速度 ${DEFAULTS.maxSpeed}、移動距離 ${DEFAULTS.maxDisplacement} で安全制限</p>
              </section>
              <section class="panel-section"><h3><span>03</span> 可視化</h3>
                <label class="control"><span>表示モード</span><select id="display-mode"><option value="combined">複合表示</option><option value="vortices">渦粒子</option><option value="tracers">トレーサー / 流跡線</option><option value="vectors">速度ベクトル</option><option value="heatmap">速度ヒートマップ</option></select></label>
                ${range('tracer-count', 'トレーサー数', 0, MAX_TRACERS, 128, DEFAULTS.tracerCount)}
                ${range('trail-length', '流跡線の長さ', 2, 32, 1, DEFAULTS.trailLength)}
                <label class="control"><span>品質</span><select id="quality-mode"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
                <label class="toggle-control"><input id="grid-enabled" type="checkbox" checked /><span></span> 背景グリッドと座標軸</label>
                <div class="sign-picker"><span>描画する循環</span><div><button data-sign="1" class="positive active">＋ 正</button><button data-sign="-1" class="negative">− 負</button></div><small>Shiftを押している間は反転</small></div>
              </section>
              <section class="panel-section performance"><h3><span>04</span> パフォーマンス</h3>
                <div class="metric-grid"><div><span>GPU STEP</span><strong id="metric-gpu">計測待ち</strong></div><div><span>VORTICES</span><strong id="metric-particles">2</strong></div><div><span>TRACERS</span><strong id="metric-tracers">—</strong></div><div><span>INTERACTIONS</span><strong id="metric-interactions">—</strong></div><div><span>FIELD GRID</span><strong id="metric-field">—</strong></div><div><span>RENDER SCALE</span><strong id="metric-render">—</strong></div></div>
                <div class="workgroup-row"><span>WORKGROUP SIZE</span><b id="metric-workgroup">64</b></div>
              </section>
              <section class="panel-section validation"><h3><span>05</span> 数値検証</h3><div id="cpu-validation"></div><div id="gpu-validation" class="validation-row pending"><span>…</span><div><strong>GPU ↔ CPU f32比較</strong><small>診断計算中</small></div></div></section>
              <footer>EDUCATIONAL CFD · O(N²) · f32<br />認証解析・安全判断には使用しないでください</footer>
            </div>
          </aside>
          <div id="drawer-scrim" class="drawer-scrim"></div>
        </main>
      </div>`;
  }

  private bindCommonControls(): void {
    this.root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      input.addEventListener('input', () => setRangeOutput(input));
    });
    const panel = requiredElement<HTMLElement>(this.root, '#control-panel');
    const scrim = requiredElement<HTMLElement>(this.root, '#drawer-scrim');
    const close = (): void => { panel.classList.remove('open'); scrim.classList.remove('open'); };
    requiredElement(this.root, '#drawer-button').addEventListener('click', () => { panel.classList.add('open'); scrim.classList.add('open'); });
    requiredElement(this.root, '#close-drawer').addEventListener('click', close);
    scrim.addEventListener('click', close);
  }

  private bindSimulationControls(canvas: HTMLCanvasElement): void {
    const controller = this.controller;
    if (!controller) return;
    const play = requiredElement<HTMLButtonElement>(this.root, '#play-button');
    play.addEventListener('click', () => {
      const playing = controller.togglePlaying();
      play.querySelector('span')!.textContent = playing ? 'Ⅱ' : '▶';
      play.querySelector('em')!.textContent = playing ? '一時停止' : '再生';
    });
    requiredElement(this.root, '#step-button').addEventListener('click', () => { controller.pause(); controller.stepOnce(); play.querySelector('span')!.textContent = '▶'; play.querySelector('em')!.textContent = '再生'; });
    requiredElement(this.root, '#reset-button').addEventListener('click', () => controller.reset());
    requiredElement(this.root, '#fit-button').addEventListener('click', () => controller.resetView());
    requiredElement(this.root, '#screenshot-button').addEventListener('click', () => saveScreenshot(canvas));

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => button.addEventListener('click', () => {
      this.root.querySelectorAll('[data-preset]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      controller.setPreset(button.dataset.preset as PresetId);
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-sign]').forEach((button) => button.addEventListener('click', () => {
      this.vortexSign = button.dataset.sign === '-1' ? -1 : 1;
      this.root.querySelectorAll('[data-sign]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    }));

    const bindNumber = (id: string, apply: (value: number) => void, changeOnly = false): void => {
      const input = requiredElement<HTMLInputElement>(this.root, `#${id}`);
      input.addEventListener(changeOnly ? 'change' : 'input', () => apply(Number(input.value)));
    };
    bindNumber('particle-count', (value) => controller.setParticleTarget(value), true);
    bindNumber('time-step', (value) => { this.parameters.dt = value; });
    bindNumber('sim-speed', (value) => { this.parameters.simulationSpeed = value; });
    bindNumber('core-radius', (value) => { this.parameters.coreRadius = value; });
    bindNumber('flow-x', (value) => { this.parameters.uniformFlowX = value; });
    bindNumber('flow-y', (value) => { this.parameters.uniformFlowY = value; });
    bindNumber('domain-width', (value) => { this.parameters.domainWidth = value; controller.resetTracers(); controller.resetView(); }, true);
    bindNumber('domain-height', (value) => { this.parameters.domainHeight = value; controller.resetTracers(); controller.resetView(); }, true);
    bindNumber('tracer-count', (value) => { this.parameters.tracerCount = value; controller.resetTracers(); }, true);
    bindNumber('trail-length', (value) => { this.parameters.trailLength = value; });
    requiredElement<HTMLSelectElement>(this.root, '#boundary-mode').addEventListener('change', (event) => { this.parameters.boundaryMode = (event.currentTarget as HTMLSelectElement).value as BoundaryMode; });
    requiredElement<HTMLSelectElement>(this.root, '#display-mode').addEventListener('change', (event) => { controller.displayMode = (event.currentTarget as HTMLSelectElement).value as DisplayMode; });
    requiredElement<HTMLSelectElement>(this.root, '#quality-mode').addEventListener('change', (event) => { controller.qualityMode = (event.currentTarget as HTMLSelectElement).value as QualityMode; });
    requiredElement<HTMLInputElement>(this.root, '#grid-enabled').addEventListener('change', (event) => { controller.gridEnabled = (event.currentTarget as HTMLInputElement).checked; });
    this.bindCanvasInteractions(canvas, controller);
    window.addEventListener('resize', () => controller.resize());
  }

  private bindCanvasInteractions(canvas: HTMLCanvasElement, controller: SimulationController): void {
    interface Point { x: number; y: number }
    const pointers = new Map<number, Point>();
    let mode: 'draw' | 'pan' = 'draw';
    let last = { x: 0, y: 0 };
    let previousPinchDistance = 0;
    let previousPinchCenter = { x: 0, y: 0 };
    let lastDraw = { x: -100, y: -100 };
    const addAt = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const [x, y] = controller.camera.screenToWorld(event.clientX, event.clientY, rect);
      const sign = event.shiftKey ? (this.vortexSign === 1 ? -1 : 1) : this.vortexSign;
      controller.addVortex(x, y, sign);
      lastDraw = { x: event.clientX, y: event.clientY };
    };
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      controller.camera.zoomAt(Math.exp(event.deltaY * 0.0012), event.clientX, event.clientY, canvas.getBoundingClientRect());
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      last = { x: event.clientX, y: event.clientY };
      mode = event.button === 1 || event.button === 2 || event.ctrlKey ? 'pan' : 'draw';
      if (pointers.size === 1 && mode === 'draw') addAt(event);
      if (pointers.size === 2) {
        const pair = [...pointers.values()];
        const a = pair[0] ?? last; const b = pair[1] ?? last;
        previousPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        previousPinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const pair = [...pointers.values()]; const a = pair[0] ?? last; const b = pair[1] ?? last;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rect = canvas.getBoundingClientRect();
        controller.camera.panPixels(center.x - previousPinchCenter.x, center.y - previousPinchCenter.y, rect.width, rect.height);
        if (previousPinchDistance > 0) controller.camera.zoomAt(previousPinchDistance / Math.max(distance, 1), center.x, center.y, rect);
        previousPinchDistance = distance; previousPinchCenter = center;
      } else if (mode === 'pan') {
        const rect = canvas.getBoundingClientRect();
        controller.camera.panPixels(event.clientX - last.x, event.clientY - last.y, rect.width, rect.height);
      } else if (Math.hypot(event.clientX - lastDraw.x, event.clientY - lastDraw.y) > 9) {
        addAt(event);
      }
      last = { x: event.clientX, y: event.clientY };
    });
    const release = (event: PointerEvent): void => { pointers.delete(event.pointerId); previousPinchDistance = 0; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private showCpuValidation(): void {
    const target = requiredElement<HTMLElement>(this.root, '#cpu-validation');
    target.innerHTML = runCpuValidation().map((result) => `<div class="validation-row ${result.passed ? 'passed' : 'failed'}"><span>${result.passed ? '✓' : '!'}</span><div><strong>${result.name}</strong><small>${result.detail}</small></div></div>`).join('');
  }

  private setGpuStatus(ready: boolean, timestamp: boolean): void {
    const chip = requiredElement<HTMLElement>(this.root, '#gpu-chip');
    chip.className = `gpu-chip ${ready ? 'ready' : 'failed'}`;
    chip.innerHTML = `<span></span>${ready ? `WebGPU READY${timestamp ? ' · TIMESTAMP' : ''}` : 'WebGPU ERROR'}`;
  }

  private showError(message: string): void {
    const banner = requiredElement<HTMLElement>(this.root, '#error-banner');
    banner.hidden = false; banner.textContent = message;
  }

  private showUnsupported(reason?: string): void {
    const overlay = requiredElement<HTMLElement>(this.root, '#unsupported');
    overlay.hidden = false;
    requiredElement<HTMLElement>(this.root, '#unsupported-reason').textContent = reason ?? 'このブラウザーではWebGPUを利用できません。';
    this.setGpuStatus(false, false);
  }
}
