import Phaser from 'phaser';

/**
 * Minimal boot scene. Asset loading (sounds copied from ../view/sounds, fonts,
 * any atlases) will live in preload() here as the port grows.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    this.scene.start('menu');
  }
}
