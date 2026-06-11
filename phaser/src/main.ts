import Phaser from 'phaser';
import { COLORS, GAME, RENDER_SCALE } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { TutorialScene } from './scenes/TutorialScene';
import { ProgressScene } from './scenes/ProgressScene';

// Extra-crisp text: on top of the camera supersample (RENDER_SCALE) we render
// every Text at 1.5× internal resolution too, so glyph edges stay sharp at the
// largest fullscreen sizes. Patch the factory once so we don't thread
// .setResolution(...) through dozens of add.text() call sites. (Kept modest —
// the camera already provides RENDER_SCALE× density, this just tops it up.)
const TEXT_RES = 1.5;
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
  // render buffer is RENDER_SCALE× the logical size; each scene's camera zooms
  // back by the same factor (applyRenderScale) so coords stay 1295×735 while
  // everything is drawn at higher pixel density → crisp under Scale.FIT.
  width: GAME.width * RENDER_SCALE,
  height: GAME.height * RENDER_SCALE,
  render: {
    antialias: true,
    roundPixels: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, TutorialScene, ProgressScene],
} as Phaser.Types.Core.GameConfig);

// handy for debugging / automated checks from the browser console
(window as unknown as { game: Phaser.Game }).game = game;
