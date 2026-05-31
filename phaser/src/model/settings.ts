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
}

const DEFAULTS: SettingsData = { unlock_all: false };

class Settings {
  private data: SettingsData = { ...DEFAULTS };

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<SettingsData>;
        if (typeof s.unlock_all === 'boolean') this.data.unlock_all = s.unlock_all;
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

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
}

export const settings = new Settings();
