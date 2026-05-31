/**
 * Persistent game settings — a minimal localStorage-backed store, the TS
 * counterpart of model/settings.py (only the flags the Phaser build needs so
 * far). Audio settings live separately in src/audio/sound.ts.
 */

const STORE_KEY = 'einsteingame_settings';

interface SettingsData {
  // When true the menu opens every size/difficulty regardless of win counts
  // (toggled with the U debug key, mirroring the pygame debug unlock).
  unlock_all: boolean;
  // Zen mode — mistakes never end the run; the result isn't recorded (no win
  // stat, no streak, no progression), only the "Inner Peace" badge is earned.
  zen: boolean;
  // How many of the 6 onboarding blocks the player has cleared (0..6). 6 means
  // the tutorial is done and every game mode is unlocked.
  tutorial_blocks: number;
}

const DEFAULTS: SettingsData = { unlock_all: false, zen: false, tutorial_blocks: 0 };

class Settings {
  private data: SettingsData = { ...DEFAULTS };

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<SettingsData>;
        if (typeof s.unlock_all === 'boolean') this.data.unlock_all = s.unlock_all;
        if (typeof s.zen === 'boolean') this.data.zen = s.zen;
        if (typeof s.tutorial_blocks === 'number' && s.tutorial_blocks >= 0) this.data.tutorial_blocks = Math.floor(s.tutorial_blocks);
      }
    } catch {
      /* keep defaults */
    }
  }

  get unlockAll(): boolean { return this.data.unlock_all; }

  set unlockAll(v: boolean) {
    this.data.unlock_all = v;
    this.save();
  }

  get zen(): boolean { return this.data.zen; }

  set zen(v: boolean) {
    this.data.zen = v;
    this.save();
  }

  get tutorialBlocks(): number { return this.data.tutorial_blocks; }

  set tutorialBlocks(v: number) {
    this.data.tutorial_blocks = Math.max(0, Math.min(6, Math.floor(v)));
    this.save();
  }

  get tutorialDone(): boolean { return this.data.tutorial_blocks >= 6; }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
}

export const settings = new Settings();
