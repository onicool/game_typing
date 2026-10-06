import { afterEach, describe, expect, it, vi } from 'vitest';
import { Audio } from './audio';

function device(state = 'running') {
  const param = () => ({ value: 0, cancelAndHoldAtTime: vi.fn(), setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => {
    const n = { gain: param(), frequency: param(), Q: param(), threshold: param(), ratio: param(),
      delayTime: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    n.connect.mockReturnValue(n);
    return n;
  };
  return { state, currentTime: 1, sampleRate: 8, destination: {}, resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()), createDynamicsCompressor: vi.fn(node), createGain: vi.fn(node),
    createDelay: vi.fn(node), createBiquadFilter: vi.fn(node), createOscillator: vi.fn(node),
    createBufferSource: vi.fn(node), createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(8) })) };
}

function install(ctx = device()) {
  const constructor = vi.fn(function () { return ctx; });
  vi.stubGlobal('AudioContext', constructor);
  return { ctx, constructor };
}

afterEach(() => vi.unstubAllGlobals());

describe('optional audio never blocks gameplay', () => {
  it('contains a combat-cue device failure without retrying on each frame', () => {
    const { ctx, constructor } = install();
    const audio = new Audio(); audio.ensure();
    ctx.createOscillator.mockImplementation(() => { throw new Error('QA unavailable oscillator'); });
    expect(() => { audio.combatCue('windup'); audio.combatCue('guard'); audio.ensure(); audio.key(0, false); }).not.toThrow();
    expect(audio.unavailable).toBe(true);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(constructor).toHaveBeenCalledTimes(1);
  });
  it('does not initialise an audio device for muted or zero-volume input', () => {
    const { constructor } = install();
    const audio = new Audio();
    audio.enabled = false;
    audio.ensure(); audio.key(3, true); audio.word(3); audio.miss(); audio.breach();
    audio.combatCue('windup'); audio.combatCue('guard'); audio.combatCue('impact');
    audio.enabled = true; audio.setVolume(0); audio.ensure();
    expect(constructor).not.toHaveBeenCalled();
    expect(audio.unavailable).toBe(false);
  });

  it.each(['missing', 'throwing'])('contains a %s constructor and retries only after off → on', kind => {
    const constructor = vi.fn(function () { throw new Error('device unavailable'); });
    vi.stubGlobal('AudioContext', kind === 'missing' ? undefined : constructor);
    const audio = new Audio(); audio.onAvailabilityChange = vi.fn();
    expect(() => { for (let i = 0; i < 100; i++) audio.ensure(); }).not.toThrow();
    expect(audio.unavailable).toBe(true);
    expect(audio.enabled).toBe(true);
    expect(audio.onAvailabilityChange).toHaveBeenCalledTimes(1);
    if (kind === 'throwing') expect(constructor).toHaveBeenCalledTimes(1);
    const repaired = install();
    audio.ensure(); expect(repaired.constructor).not.toHaveBeenCalled();
    audio.enabled = false; audio.enabled = true; audio.ensure(); audio.key(0, false);
    expect(audio.unavailable).toBe(false);
    expect(repaired.ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('closes a partial graph and keeps volume and mute controls usable', () => {
    const { ctx } = install();
    ctx.createBuffer.mockImplementationOnce(() => { throw new Error('allocation'); });
    const audio = new Audio(); audio.ensure();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(() => { audio.setVolume(0.4); audio.enabled = false; }).not.toThrow();
    audio.enabled = true; audio.ensure(); audio.key(0, false);
    expect(audio.unavailable).toBe(false);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it.each(['key', 'miss', 'word', 'breach'] as const)('contains a %s synthesis fault without repeated allocations', effect => {
    const { ctx, constructor } = install();
    const audio = new Audio(); audio.ensure(); audio.onAvailabilityChange = vi.fn();
    ctx.createOscillator.mockImplementation(() => { throw new Error('node failed'); });
    const trigger = () => effect === 'key' ? audio.key(3, true) : effect === 'word' ? audio.word(3) : audio[effect]();
    expect(trigger).not.toThrow();
    expect(() => { audio.ensure(); trigger(); audio.setVolume(0.5); }).not.toThrow();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(audio.onAvailabilityChange).toHaveBeenCalledTimes(1);
    expect(audio.unavailable).toBe(true);
  });

  it('contains gain automation and synchronous or asynchronous close failure', async () => {
    const { ctx } = install(); const audio = new Audio(); audio.ensure();
    ctx.createGain.mock.results[0].value.gain.cancelAndHoldAtTime.mockImplementation(() => { throw new Error('gain'); });
    ctx.close.mockRejectedValueOnce(new Error('closed'));
    expect(() => audio.setVolume(0.4)).not.toThrow();
    await Promise.resolve();
    expect(audio.unavailable).toBe(true);
    const second = install(); second.ctx.createDelay.mockImplementationOnce(() => { throw new Error('delay'); });
    second.ctx.close.mockImplementationOnce(() => { throw new Error('close'); });
    audio.enabled = false; audio.enabled = true;
    expect(() => audio.ensure()).not.toThrow();
    expect(audio.unavailable).toBe(true);
  });

  it('resumes once while pending and does not queue sounds on a suspended device', async () => {
    const { ctx } = install(device('suspended'));
    let resolve!: () => void;
    ctx.resume.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const audio = new Audio();
    for (let i = 0; i < 100; i++) { audio.ensure(); audio.key(0, false); }
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    ctx.state = 'running'; resolve(); await Promise.resolve(); audio.key(0, false);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('handles resume rejection and can recreate a closed context without an obsolete rejection disabling it', async () => {
    const first = install(device('suspended'));
    let reject!: (error: Error) => void;
    first.ctx.resume.mockReturnValue(new Promise<void>((_, fail) => { reject = fail; }));
    const audio = new Audio(); audio.ensure();
    first.ctx.state = 'closed'; const next = install(); audio.ensure();
    reject(new Error('old context closed')); await Promise.resolve(); await Promise.resolve();
    expect(audio.unavailable).toBe(false);
    audio.key(0, false); expect(next.ctx.createOscillator).toHaveBeenCalledTimes(2);
    next.ctx.state = 'suspended'; next.ctx.resume.mockRejectedValue(new Error('resume denied'));
    audio.ensure(); await Promise.resolve(); await Promise.resolve();
    expect(audio.unavailable).toBe(true);
    expect(next.ctx.close).toHaveBeenCalledTimes(1);
    audio.ensure(); expect(next.ctx.resume).toHaveBeenCalledTimes(1);
  });
});
