import Phaser from 'phaser';
import { COLORS, FONT, palette, brighten } from '../config';

export interface ToggleHandle {
  root: Phaser.GameObjects.Container;
  setValue(on: boolean): void;
}

/**
 * A labelled on/off switch. Label on the left, a pill switch on the right.
 * (x, y) is the top-left; `w` the full width. Clicking anywhere on the row
 * toggles it.
 */
export function makeToggle(
  scene: Phaser.Scene,
  x: number, y: number, w: number,
  label: string, on: boolean,
  onChange: (on: boolean) => void,
  s = 1, // size scale (mobile/portrait bumps everything up)
): ToggleHandle {
  const h = 30 * s;
  const pillW = 46 * s;
  const pillH = 24 * s;
  const pillX = w - pillW;
  const pillCY = h / 2;

  const labelT = scene.add.text(0, h / 2, label, { fontFamily: FONT, fontSize: `${Math.round(15 * s)}px`, color: palette.text }).setOrigin(0, 0.5);
  const g = scene.add.graphics();
  const knob = scene.add.circle(0, pillCY, pillH / 2 - 3 * s, 0xffffff);

  let value = on;
  const redraw = () => {
    g.clear();
    g.fillStyle(value ? COLORS.accent : brighten(COLORS.panel, 26), 1);
    g.fillRoundedRect(pillX, pillCY - pillH / 2, pillW, pillH, pillH / 2);
    knob.setPosition(value ? pillX + pillW - pillH / 2 : pillX + pillH / 2, pillCY);
    knob.setFillStyle(value ? 0x1c1a1e : 0xbdb6bd);
  };

  const hit = scene.add.rectangle(w / 2, h / 2, w, h, 0xffffff, 0).setInteractive({ useHandCursor: true });
  hit.on('pointerdown', () => { value = !value; redraw(); onChange(value); });

  const root = scene.add.container(x, y, [labelT, g, knob, hit]);
  redraw();

  return {
    root,
    setValue(v: boolean) { value = v; redraw(); },
  };
}
