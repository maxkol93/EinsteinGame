import Phaser from 'phaser';
import { COLORS, palette } from '../config';

export interface ButtonOpts {
  fontSize?: number;
  fill?: number;
  textColor?: string;
  selected?: boolean;
}

export interface UIButton extends Phaser.GameObjects.Container {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  setSelected(on: boolean): void;
}

/** A rounded-look rectangular button with hover/press feedback. */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): UIButton {
  const fill = opts.fill ?? COLORS.panel;
  const bg = scene.add.rectangle(0, 0, w, h, fill).setStrokeStyle(2, COLORS.accent, opts.selected ? 0.9 : 0.22);
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: 'Arial, sans-serif',
      fontStyle: 'bold',
      fontSize: `${opts.fontSize ?? 22}px`,
      color: opts.textColor ?? palette.text,
    })
    .setOrigin(0.5);

  const c = scene.add.container(x, y, [bg, label]) as UIButton;
  c.bg = bg;
  c.label = label;
  c.setSize(w, h);
  c.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);

  let selected = !!opts.selected;
  c.setSelected = (on: boolean) => {
    selected = on;
    bg.setStrokeStyle(2, COLORS.accent, on ? 0.9 : 0.22);
    bg.setFillStyle(on ? COLORS.panel : fill, 1);
  };
  c.on('pointerover', () => bg.setStrokeStyle(2, COLORS.accent, selected ? 1 : 0.6));
  c.on('pointerout', () => bg.setStrokeStyle(2, COLORS.accent, selected ? 0.9 : 0.22));
  c.on('pointerdown', () => {
    scene.tweens.add({ targets: c, scale: 0.95, duration: 70, yoyo: true });
    onClick();
  });
  return c;
}
