import Phaser from 'phaser';
import { audio } from '../audio/sound';
import { settings } from '../model/settings';

/**
 * Boot: load the SFX/music bank, wait for the DejaVu Sans webfont so the first
 * glyphs render in the right face (not a fallback that lacks Roman numerals /
 * currency / Greek), then go to the menu.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    audio.preload(this);
  }

  create(): void {
    audio.init(this.game);
    // A brand-new player (no onboarding cleared yet) goes straight into the
    // tutorial; everyone else lands on the menu.
    const first = settings.tutorialBlocks === 0;
    const go = () => this.scene.start(first ? 'tutorial' : 'menu');
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      Promise.all([fonts.load('16px "DejaVu Sans"'), fonts.load('bold 16px "DejaVu Sans"')])
        .then(() => fonts.ready)
        .then(go)
        .catch(go);
    } else {
      go();
    }
  }
}
