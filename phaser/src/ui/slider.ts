import Phaser from 'phaser';
import { COLORS, FONT, palette, brighten } from '../config';

export interface SliderHandle {
  root: Phaser.GameObjects.Container;
  setValue(v: number): void;
}

/**
 * A labelled horizontal slider (0..1). The label sits above a rounded track
 * with a filled portion + a draggable knob and a live percentage on the right.
 * (x, y) is the top-left of the control; `w` is the full width.
 */
export function makeSlider(
  scene: Phaser.Scene,
  x: number, y: number, w: number,
  label: string, value: number,
  onChange: (v: number) => void,
  s = 1, // size scale (mobile/portrait bumps everything up)
): SliderHandle {
  const trackY = 24 * s;
  const trackW = w - 60 * s;
  const trackH = 8 * s;
  const r = 8 * s;

  const labelT = scene.add.text(0, 0, label, { fontFamily: FONT, fontSize: `${Math.round(15 * s)}px`, color: palette.accent }).setOrigin(0, 0);
  const pctT = scene.add.text(w, 0, '', { fontFamily: FONT, fontSize: `${Math.round(14 * s)}px`, color: palette.text }).setOrigin(1, 0);

  const g = scene.add.graphics();
  const knob = scene.add.circle(0, trackY + trackH / 2, 9 * s, COLORS.accent).setStrokeStyle(2, brighten(COLORS.accent, 40));

  let v = Math.max(0, Math.min(1, value));

  const redraw = () => {
    g.clear();
    g.fillStyle(brighten(COLORS.panel, 24), 1);
    g.fillRoundedRect(0, trackY, trackW, trackH, r / 2);
    g.fillStyle(COLORS.accent, 1);
    g.fillRoundedRect(0, trackY, Math.max(trackH, trackW * v), trackH, r / 2);
    knob.setPosition(trackW * v, trackY + trackH / 2);
    pctT.setText(`${Math.round(v * 100)}%`);
  };

  // a wide invisible hit strip over the track for easy grabbing
  const hit = scene.add.rectangle(trackW / 2, trackY + trackH / 2, trackW + 24, 40 * s, 0xffffff, 0).setInteractive({ useHandCursor: true });
  const setFromX = (worldX: number) => {
    // worldX (not pointer.x) so it works under the supersample camera zoom
    v = Math.max(0, Math.min(1, (worldX - root.x) / trackW));
    redraw();
    onChange(v);
  };
  let dragging = false;
  hit.on('pointerdown', (p: Phaser.Input.Pointer) => { dragging = true; setFromX(p.worldX); });
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (dragging) setFromX(p.worldX); });
  scene.input.on('pointerup', () => { dragging = false; });

  const root = scene.add.container(x, y, [labelT, pctT, g, knob, hit]);
  redraw();

  return {
    root,
    setValue(nv: number) { v = Math.max(0, Math.min(1, nv)); redraw(); },
  };
}
