import Phaser from 'phaser';
import { COLORS, FONT, palette, brighten } from '../config';
import { roundedTex, strokedRoundedTex } from './textures';
import { audio } from '../audio/sound';

export interface ButtonOpts {
  fontSize?: number;
  fill?: number;
  textColor?: string;
  selected?: boolean;
  radius?: number;
}

export interface BtnHandle {
  root: Phaser.GameObjects.Container;
  setSelected(on: boolean): void;
  setText(text: string): void;
}

/**
 * Rounded button. The interactive element is the background *Image* (a tinted
 * rounded-rect texture) — NOT the container. A container's custom hit-area is
 * framed differently from a GameObject's and ends up offset; an Image's hit
 * area is its own (origin-0.5) frame, so collider == visual exactly.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  text: string, onClick: () => void, opts: ButtonOpts = {},
): BtnHandle {
  const radius = opts.radius ?? 12;
  const fill = opts.fill ?? COLORS.panel;
  const bg = scene.add.image(0, 0, roundedTex(scene, w, h, radius)).setTint(fill);
  bg.setInteractive({ useHandCursor: true });
  const outline = scene.add
    .image(0, 0, strokedRoundedTex(scene, w, h, radius, 3))
    .setTint(0xffffff)
    .setAlpha(opts.selected ? 0.9 : 0);
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: FONT, fontStyle: 'bold',
      fontSize: `${opts.fontSize ?? 21}px`,
      color: opts.textColor ?? palette.text,
    })
    .setOrigin(0.5);
  const root = scene.add.container(x, y, [bg, outline, label]);

  let selected = !!opts.selected;
  const refreshOutline = () => outline.setAlpha(selected ? 0.9 : 0);

  bg.on('pointerover', () => {
    scene.tweens.add({ targets: root, scaleX: 1.03, scaleY: 1.03, duration: 90 });
    bg.setTint(brighten(fill, 42));
    if (!selected) outline.setAlpha(0.5);
  });
  bg.on('pointerout', () => {
    scene.tweens.add({ targets: root, scaleX: 1, scaleY: 1, duration: 90 });
    bg.setTint(selected ? brighten(fill, 18) : fill);
    refreshOutline();
  });
  bg.on('pointerdown', () => {
    scene.tweens.add({ targets: root, scaleX: 0.96, scaleY: 0.96, duration: 70, yoyo: true });
    audio.play('click');
    onClick();
  });

  return {
    root,
    setSelected(on: boolean) {
      selected = on;
      bg.setTint(on ? brighten(fill, 18) : fill);
      refreshOutline();
    },
    setText(t: string) {
      label.setText(t);
    },
  };
}
