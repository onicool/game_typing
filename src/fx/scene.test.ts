import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene } from './scene';

function setup(recordDrawCalls = true) {
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const ctx = new Proxy({}, { get: (_, key) => {
    const name = String(key);
    if (!methods.has(name)) {
      const draw = () => name === 'createRadialGradient' ? { addColorStop() {} } : undefined;
      // Stress checks inspect retained scene state, not millions of recorded
      // drawing arguments. Keep the same drawing behavior without mock history.
      methods.set(name, recordDrawCalls ? vi.fn(draw) : draw as ReturnType<typeof vi.fn>);
    }
    return methods.get(name);
  } }) as CanvasRenderingContext2D;
  const canvas = Object.assign(new EventTarget(), {
    width: 0, height: 0,
    parentElement: { classList: { toggle: vi.fn() } },
    getContext: vi.fn(() => ctx),
  });
  const scene = new Scene(canvas as unknown as HTMLCanvasElement);
  scene.setEffects({ shake: 0, flash: 0, motion: 1 });
  scene.frame(1000);
  const hooks = scene as unknown as { showBreach(): void; showLayerBreak(): void; addCrack(at: number[]): void };
  return { scene, canvas, methods, breach: vi.spyOn(hooks, 'showBreach'), layer: vi.spyOn(hooks, 'showLayerBreak'), crack: vi.spyOn(hooks, 'addCrack') };
}

afterEach(() => vi.unstubAllGlobals());

describe('packet completion and independent graphics fallback', () => {
  it('contains optional image construction failures without losing canvas or input feedback', () => {
    const { scene, layer } = setup();
    vi.stubGlobal('Image', class { constructor() { throw new Error('Synthetic image construction failure'); } });
    expect(() => scene.setBackground('/art.png')).not.toThrow();
    expect(() => scene.setTarget('/enemy.png')).not.toThrow();
    scene.hit(false); scene.layerBreak(); scene.frame(1050); scene.frame(1100);
    expect(layer).toHaveBeenCalledTimes(1);
  });
  it('breaks every completed word once and isolates consecutive barrier packets', () => {
    const { scene, layer, crack } = setup();
    scene.hit(false); scene.layerBreak(); scene.layerBreak();
    scene.hit(true); scene.layerBreak();
    scene.frame(1050); scene.frame(1075);
    expect(layer).not.toHaveBeenCalled();
    scene.frame(1090);
    expect(layer).toHaveBeenCalledTimes(2);
    expect(crack).toHaveBeenCalledTimes(4);
    expect((scene as unknown as { generation: number }).generation).toBe(2);
  });

  it('freezes travel, pending impacts and particles during pause without a resume jump', () => {
    const { scene, layer } = setup();
    scene.hit(false); scene.layerBreak(); scene.frame(1040);
    const state = scene as unknown as { tunnelZ: number; time: number; packets: { t: number }[] };
    const snapshot = [state.tunnelZ, state.time, state.packets[0].t];
    scene.setActive(false); scene.frame(1100); scene.frame(60100);
    expect([state.tunnelZ, state.time, state.packets[0].t]).toEqual(snapshot);
    expect(layer).not.toHaveBeenCalled();
    scene.setActive(true); scene.frame(60116);
    expect(layer).not.toHaveBeenCalled();
    scene.frame(60150);
    expect(layer).toHaveBeenCalledTimes(1);
  });

  it('makes accepted input drive travel but a miss cannot advance or complete the barrier', () => {
    const { scene, layer, breach } = setup();
    const state = scene as unknown as { thrust: number; inputGeneration: number };
    scene.miss(); expect(state.thrust).toBe(0);
    scene.hit(false); expect(state.thrust).toBeGreaterThan(0);
    scene.miss(); scene.frame(1050); scene.frame(1100);
    expect(state.inputGeneration).toBe(0);
    expect(layer).not.toHaveBeenCalled(); expect(breach).not.toHaveBeenCalled();
  });

  it('keeps motion-off barrier size and travel fixed and clears progress on reset', () => {
    const { scene } = setup();
    scene.setEffects({ shake: 0, flash: 0, motion: 0 });
    scene.frame(1016);
    const state = scene as unknown as { cubeRadius: number; tunnelZ: number; progressByGeneration: Map<number, number> };
    const snapshot = [state.cubeRadius, state.tunnelZ];
    scene.setProgress(1); scene.hit(false); scene.frame(1066);
    expect([state.cubeRadius, state.tunnelZ]).toEqual(snapshot);
    scene.setProgress(Number.NaN); expect(state.progressByGeneration.get(0)).toBe(0);
    scene.reset(); expect(state.progressByGeneration.size).toBe(0);
  });
  it('does not break a layer before the completing packet arrives', () => {
    const { scene, layer } = setup();
    scene.hit(false); scene.layerBreak();
    scene.frame(1040); scene.frame(1080);
    expect(layer).not.toHaveBeenCalled();
    scene.frame(1090);
    expect(layer).toHaveBeenCalledTimes(1);
  });

  it('opens the wall once on arrival, even when layer and breach are both requested', () => {
    const { scene, layer, breach } = setup();
    scene.hit(false); scene.layerBreak(); scene.breach();
    expect(breach).not.toHaveBeenCalled();
    scene.frame(1050); scene.frame(1100); scene.frame(1150);
    expect(breach).toHaveBeenCalledTimes(1);
    expect(layer).not.toHaveBeenCalled();
  });

  it('holds a quicker next-wall critical until the prior completion arrives', () => {
    const { scene, breach, crack } = setup();
    scene.hit(false); scene.layerBreak(); scene.breach();
    scene.hit(true); scene.layerBreak(); scene.breach();
    scene.frame(1050); scene.frame(1075);
    expect(breach).not.toHaveBeenCalled();
    expect(crack).not.toHaveBeenCalled();
    scene.frame(1090);
    expect(breach).toHaveBeenCalledTimes(2);
    expect(crack).toHaveBeenCalledTimes(4);
  });

  it('never lets an old in-flight packet crack the replacement wall', () => {
    const { scene, breach, crack } = setup();
    scene.hit(false);
    scene.hit(true); scene.layerBreak(); scene.breach();
    scene.frame(1050); scene.frame(1075);
    expect(breach).toHaveBeenCalledTimes(1);
    expect(crack).toHaveBeenCalledTimes(3);
    scene.frame(1090);
    expect(crack).toHaveBeenCalledTimes(3);
  });

  it('keeps completion feedback with motion off and prevents delayed effects after reset', () => {
    const { scene, breach } = setup();
    scene.setEffects({ shake: 0, flash: 0, motion: 0 });
    scene.hit(false); scene.layerBreak(); scene.breach(); scene.frame(1016);
    expect(breach).toHaveBeenCalledTimes(1);
    scene.hit(false); scene.layerBreak(); scene.breach(); scene.reset(); scene.frame(1066);
    expect(breach).toHaveBeenCalledTimes(1);
  });

  it('reduces the backing store on high-DPI displays and restores normal quality', () => {
    const { scene, canvas } = setup();
    expect([canvas.width, canvas.height]).toEqual([3840, 2160]);
    scene.setLowGraphics(true);
    expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
    scene.setLowGraphics(false);
    expect([canvas.width, canvas.height]).toEqual([3840, 2160]);
  });

  it('survives context loss and resumes only after a restore event', () => {
    const { scene, canvas, breach } = setup();
    scene.hit(false); scene.layerBreak(); scene.breach();
    canvas.dispatchEvent(new Event('contextlost'));
    scene.frame(1100);
    expect(breach).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event('contextrestored'));
    scene.hit(false); scene.layerBreak(); scene.breach(); scene.frame(1200); scene.frame(1250); scene.frame(1300);
    expect(breach).toHaveBeenCalledTimes(1);
  });

  it('contains context acquisition and draw failures within the scene', () => {
    const { scene, canvas, methods } = setup();
    methods.get('fillRect')!.mockImplementationOnce(() => { throw new Error('Synthetic draw failure'); });
    expect(() => scene.frame(1050)).not.toThrow();
    expect(canvas.parentElement.classList.toggle).toHaveBeenLastCalledWith('scene-unavailable', true);
    canvas.getContext.mockImplementationOnce(() => { throw new Error('Synthetic context unavailable'); });
    expect(() => canvas.dispatchEvent(new Event('contextrestored'))).not.toThrow();
    expect(() => scene.frame(1100)).not.toThrow();
  });

  it('drains transient graphics after sustained completions and bounds retained caches', () => {
    const { scene } = setup(false);
    let now = 1000;
    for (let i = 0; i < 300; i++) {
      scene.hit(i % 2 === 0); scene.layerBreak();
      if (i % 5 === 4) scene.breach();
      for (let j = 0; j < 8; j++) scene.frame(now += 16);
    }
    for (let i = 0; i < 100; i++) scene.frame(now += 16);
    const state = scene as unknown as Record<'packets' | 'openings' | 'sparks' | 'shards' | 'rings' | 'texts' | 'cracks' | 'drifters', unknown[]> & { generation: number; coreGradients: Map<number, unknown> };
    for (const key of ['packets', 'openings', 'sparks', 'shards', 'rings', 'texts'] as const) expect(state[key]).toHaveLength(0);
    expect(state.generation).toBe(300);
    expect(state.cracks.length).toBeLessThanOrEqual(36);
    expect(state.coreGradients.size).toBeLessThanOrEqual(30);
    expect(state.drifters).toHaveLength(14);
  });
});
