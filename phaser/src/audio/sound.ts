import Phaser from 'phaser';

/**
 * The sound layer — a faithful port of view/sounds.py, but on Phaser's
 * WebAudio backend instead of the pygame SDL mixer. (Audio stutter/lag on the
 * pygbag mixer was one of the three reasons we left pygame; WebAudio handles
 * the user-gesture unlock and mixing natively, so the hacks in sounds.py /
 * build_web.sh are gone.)
 *
 * A module singleton (`audio`) bound once to the game's global sound manager,
 * so any scene can `audio.play('pick')` without threading a manager through.
 * Everything degrades gracefully: before the assets load, or if WebAudio is
 * unavailable, calls are no-ops — never throws.
 */

// Short SFX bank. pick_2/3/4 are higher-pitched variants played by cascade
// depth so a chain reads as a rising arpeggio (combo-pitch). 'hover' exists in
// the bank but stays unused — a per-hover tick is the densest, least valuable
// voice (the same call we dropped in the pygame web build).
export const SOUND_KEYS = [
  'spread', 'click', 'pick', 'pick_2', 'pick_3', 'pick_4',
  'solve', 'wrong', 'win', 'lose', 'start',
] as const;
export type SoundKey = (typeof SOUND_KEYS)[number];

// Music: a dedicated looping bed for the menu, and one of several looping beds
// for the playing field — a random game loop is chosen per game session.
const MENU_LOOP = 'menu_loop';
const GAME_LOOPS = ['game_loop_1', 'game_loop_2', 'game_loop_3'];
type MusicContext = 'menu' | 'game';

// Per-sound trim so one master volume stays musically balanced (mirrors
// _SOUND_GAIN): subtle UI ticks, prominent game events.
const GAIN: Record<string, number> = {
  spread: 0.45, click: 0.8, pick: 0.6, pick_2: 0.6, pick_3: 0.6, pick_4: 0.6,
  solve: 0.8, wrong: 0.85, win: 0.95, lose: 0.9, start: 0.72,
};

// Minimum gap (ms) between repeats of the *same* sound, so a rapid burst of
// identical triggers doesn't comb-filter into a flange-y mush (mirrors
// _SOUND_THROTTLE, in milliseconds).
const THROTTLE: Record<string, number> = {
  spread: 180, click: 60, pick: 45, pick_2: 45, pick_3: 45, pick_4: 45,
  solve: 50, wrong: 150, win: 300, lose: 300, start: 200,
};
const DEFAULT_THROTTLE = 60;

const PICK_LADDER: SoundKey[] = ['pick', 'pick_2', 'pick_3', 'pick_4'];

const LS_KEY = 'einstein.audio';

interface Persisted {
  volume: number;
  musicVolume: number;
  sfxOn: boolean;
  musicOn: boolean;
}

class AudioManager {
  private sound?: Phaser.Sound.BaseSoundManager;
  private music?: Phaser.Sound.BaseSound;
  private currentKey?: string; // the loop key currently loaded into `music`
  private musicContext?: MusicContext; // which bed is (or should be) playing
  private last: Record<string, number> = {};
  private clock = 0;

  private volume = 0.7;
  private musicVolume = 0.5;
  private sfxOn = true;
  private musicOn = true;

  /** Bind to the game's global sound manager and add every loaded sound. Safe
   *  to call once after the loader (BootScene) has the bank in the cache. */
  init(game: Phaser.Game): void {
    if (this.sound) return;
    this.sound = game.sound;
    this.load();
  }

  /** Queue the whole bank on a scene's loader. Call from a scene `preload()`. */
  preload(scene: Phaser.Scene): void {
    for (const k of SOUND_KEYS) scene.load.audio(k, `sounds/${k}.ogg`);
    for (const k of [MENU_LOOP, ...GAME_LOOPS]) scene.load.audio(k, `sounds/${k}.ogg`);
  }

  // ---- persistence ----
  private load(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted>;
        if (typeof p.volume === 'number') this.volume = clamp01(p.volume);
        if (typeof p.musicVolume === 'number') this.musicVolume = clamp01(p.musicVolume);
        if (typeof p.sfxOn === 'boolean') this.sfxOn = p.sfxOn;
        if (typeof p.musicOn === 'boolean') this.musicOn = p.musicOn;
      }
    } catch {
      /* private mode / no storage — keep defaults */
    }
  }

  private persist(): void {
    try {
      const p: Persisted = {
        volume: this.volume, musicVolume: this.musicVolume,
        sfxOn: this.sfxOn, musicOn: this.musicOn,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }

  // ---- SFX ----
  /** Play a one-shot effect, gain-trimmed and throttled. */
  play(key: SoundKey): void {
    if (!this.sound || !this.sfxOn) return;
    if (!this.sound.get(key) && !this.cacheHas(key)) return;
    const now = (this.clock = nowMs());
    const gap = THROTTLE[key] ?? DEFAULT_THROTTLE;
    const last = this.last[key] ?? -1e9;
    if (now - last < gap) return;
    this.last[key] = now;
    try {
      this.sound.play(key, { volume: this.volume * (GAIN[key] ?? 1) });
    } catch {
      /* ignore */
    }
  }

  /** The pick-sound key for a 0-based cascade depth, capped at the ladder top. */
  pickForStep(step: number): SoundKey {
    return PICK_LADDER[Math.max(0, Math.min(step, PICK_LADDER.length - 1))];
  }

  /** A RANDOM pick variant — used for a plain candidate pop so repeated pops
   *  don't sound identical. (The cascade still uses the rising pickForStep.) */
  randomPick(): void {
    this.play(PICK_LADDER[Math.floor(Math.random() * PICK_LADDER.length)]);
  }

  private cacheHas(key: string): boolean {
    return !!this.sound?.game.cache.audio.exists(key);
  }

  // ---- music ----
  /** Start the looping bed for a context: `menu_loop` in the menu, or a RANDOM
   *  game loop on the playing field (re-rolled each time the game context is
   *  (re)entered). Switching context stops the previous bed. Idempotent within
   *  a context — it won't restart a menu bed that's already playing, but each
   *  fresh entry into 'game' picks a new loop. WebAudio auto-unlocks on the
   *  first user gesture, so an early call becomes audible once it resumes. */
  playMusic(context: MusicContext): void {
    this.musicContext = context;
    if (!this.sound || !this.musicOn) return;
    // already in the menu bed and it's running → leave it
    if (context === 'menu' && this.music && this.currentKey === MENU_LOOP && this.music.isPlaying) return;
    this.stopMusic();
    const key = context === 'menu' ? MENU_LOOP : GAME_LOOPS[Math.floor(Math.random() * GAME_LOOPS.length)];
    if (!this.cacheHas(key)) return;
    this.currentKey = key;
    this.music = this.sound.add(key, { loop: true, volume: this.musicVolume });
    this.music.play();
  }

  /** Back-compat shim — older call sites used startMusic() for the menu bed. */
  startMusic(): void {
    this.playMusic('menu');
  }

  stopMusic(): void {
    this.music?.stop();
    this.music?.destroy();
    this.music = undefined;
    this.currentKey = undefined;
  }

  // ---- volume (for the menu sliders) ----
  get sfxVolume(): number { return this.volume; }
  get musicVolume2(): number { return this.musicVolume; }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.persist();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    if (this.music) {
      (this.music as Phaser.Sound.WebAudioSound).setVolume(this.musicVolume);
      // raising from 0 must always bring the bed back — if WebAudio culled the
      // silent loop (it can), re-assert playback
      if (this.musicVolume > 0 && this.musicOn && !this.music.isPlaying) this.music.play();
    } else if (this.musicVolume > 0 && this.musicContext) {
      this.playMusic(this.musicContext);
    }
    this.persist();
  }

  // ---- settings getters/setters (for the menu toggles) ----
  get sfxEnabled(): boolean { return this.sfxOn; }
  get musicEnabled(): boolean { return this.musicOn; }

  setSfxEnabled(on: boolean): void {
    this.sfxOn = on;
    this.persist();
    if (on) this.play('click');
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    this.persist();
    if (on) this.playMusic(this.musicContext ?? 'menu');
    else this.stopMusic();
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// performance.now() is the browser monotonic clock; fall back to a manual tick
// if it's somehow missing so throttling still works.
function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
}

export const audio = new AudioManager();
