import Phaser from 'phaser';
import { audio } from '../audio/sound';

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
    const go = () => this.scene.start('menu');
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
