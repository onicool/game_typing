import { describe, expect, it, vi } from 'vitest';
import { Music, MUSIC_TRACKS } from './music';

function setup() {
  const media = { src: '', currentTime: 0, paused: true, loop: false, playbackRate: 0, volume: 1, muted: false,
    onplaying: null, onpause: null, onerror: null,
    play: vi.fn(function () { media.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { media.paused = true; }), removeAttribute: vi.fn(), load: vi.fn() };
  const factory = vi.fn(() => media as unknown as HTMLAudioElement);
  const music = new Music(factory);
  return { music, media, factory };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('ordinary background music lifecycle', () => {
  it('does not create or autoplay a player at load or when preferences are restored', () => {
    const { music, factory } = setup();
    music.setEnabled(true); music.setVolume(.6); music.resume();
    expect(factory).not.toHaveBeenCalled(); expect(music.status).toBe('idle');
  });
  it('starts a single normal-speed looping track independently of keys', async () => {
    const { music, media, factory } = setup();
    music.start(MUSIC_TRACKS[0]); await settle();
    expect(media.src).toBe(MUSIC_TRACKS[0].url);
    expect(media.loop).toBe(true); expect(media.playbackRate).toBe(1);
    expect(music.status).toBe('playing');
    media.currentTime = 17;
    music.resume(); music.resume(); music.setVolume(.2);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.currentTime).toBe(17); expect(factory).toHaveBeenCalledTimes(1);
  });
  it('mutes and pauses at zero volume, then resumes from the same position', async () => {
    const { music, media } = setup(); music.start(MUSIC_TRACKS[0]); await settle(); media.currentTime = 10;
    music.setVolume(0); expect(media.paused).toBe(true); expect(media.muted).toBe(true); expect(music.status).toBe('muted');
    music.setVolume(.5); await settle(); expect(media.volume).toBe(.5); expect(media.currentTime).toBe(10); expect(music.status).toBe('playing');
    music.setEnabled(false); expect(media.paused).toBe(true);
    music.setEnabled(true); await settle(); expect(music.status).toBe('playing'); expect(media.currentTime).toBe(10);
  });
  it('honors mute at start and never plays while paused even if the controls change', async () => {
    const { music, media } = setup(); music.setEnabled(false); music.start(MUSIC_TRACKS[0]);
    expect(media.play).not.toHaveBeenCalled();
    music.pause(); music.setEnabled(true); music.setVolume(.4);
    expect(media.play).not.toHaveBeenCalled();
    music.resume(); await settle(); expect(media.play).toHaveBeenCalledTimes(1);
  });
  it('pauses on navigation and starts the next track without another player or overlap', async () => {
    const { music, media, factory } = setup(); music.start(MUSIC_TRACKS[0]); await settle(); media.currentTime = 10;
    music.pause(); expect(media.paused).toBe(true); expect(media.currentTime).toBe(10);
    music.resume(); await settle(); expect(media.currentTime).toBe(10);
    music.stop(); expect(media.paused).toBe(true); expect(music.status).toBe('idle');
    music.resume(); expect(media.play).toHaveBeenCalledTimes(2);
    music.start(MUSIC_TRACKS[1]); await settle(); expect(media.currentTime).toBe(0);
    expect(media.src).toBe(MUSIC_TRACKS[1].url); expect(factory).toHaveBeenCalledTimes(1);
  });
  it('contains autoplay rejection and retries only after a deliberate action', async () => {
    const { music, media } = setup(); media.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    music.start(MUSIC_TRACKS[0]); await settle();
    expect(music.status).toBe('unavailable');
    music.resume(); music.resume(); expect(media.play).toHaveBeenCalledTimes(1);
    music.setEnabled(false); music.setEnabled(true); await settle();
    expect(music.status).toBe('playing'); expect(media.play).toHaveBeenCalledTimes(2);
  });
  it('ignores a stale rejection after track change and keeps a late success paused', async () => {
    const { music, media } = setup(); let reject!: (error: Error) => void;
    media.play.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    music.start(MUSIC_TRACKS[0]); music.start(MUSIC_TRACKS[1]); await settle();
    reject(new Error('old play interrupted')); await settle(); expect(music.status).toBe('playing');
    const next = setup(); let finish!: () => void;
    next.media.play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { next.media.paused = false; resolve(); }; }));
    next.music.start(MUSIC_TRACKS[0]); next.music.pause(); finish(); await settle();
    expect(next.media.paused).toBe(true); expect(next.music.status).toBe('paused');
  });
  it('contains missing or invalid media and clamps volume', () => {
    const { music, media } = setup(); music.start(MUSIC_TRACKS[0]);
    (media.onerror as unknown as (() => void))(); expect(music.status).toBe('unavailable'); expect(media.paused).toBe(true);
    music.setVolume(Number.NaN); expect(music.volume).toBe(0);
    music.setVolume(2); expect(music.volume).toBe(1);
    const broken = new Music(() => { throw new Error('No audio device'); });
    expect(() => broken.start(MUSIC_TRACKS[0])).not.toThrow(); expect(broken.status).toBe('unavailable');
  });
});
