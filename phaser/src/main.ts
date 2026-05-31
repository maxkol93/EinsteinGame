import Phaser from 'phaser';
import { COLORS, GAME } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

// Crisp text under Scale.FIT: the 1295×735 backing buffer is stretched to fill
// the screen, so text textures (rendered at 1×) blur when the canvas is scaled
// up. Render every Text at a higher internal resolution so it stays sharp even
// fullscreen on a HiDPI display. Patch the factory once so we don't have to
// thread .setResolution(...) through dozens of add.text() call sites.
const TEXT_RES = Math.min(4, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 1.5)));
const factory = Phaser.GameObjects.GameObjectFactory.prototype;
const baseText = factory.text;
factory.text = function patchedText(this: Phaser.GameObjects.GameObjectFactory, ...args) {
  const t = (baseText as (...a: unknown[]) => Phaser.GameObjects.Text).apply(this, args);
  t.setResolution(TEXT_RES);
  return t;
} as typeof factory.text;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.bg,
  width: GAME.width,
  height: GAME.height,
  resolution: window.devicePixelRatio || 1,
  render: {
    antialias: true,
    roundPixels: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene],
} as Phaser.Types.Core.GameConfig);

// handy for debugging / automated checks from the browser console
(window as unknown as { game: Phaser.Game }).game = game;
