import asyncio
import os

import pygame

from presenter.game import Game
from view.window import CANVAS_WIDTH, CANVAS_HEIGHT


async def main():
    # A small mixer buffer keeps the UI SFX low-latency. Both calls are
    # wrapped: a machine with no audio device must still run the game.
    try:
        pygame.mixer.pre_init(44100, -16, 2, 512)
    except pygame.error:
        pass
    pygame.init()
    try:
        pygame.mixer.init()
    except pygame.error:
        pass
    pygame.display.set_caption('Einstein game')
    pygame.display.set_mode((CANVAS_WIDTH, CANVAS_HEIGHT))

    palette = os.environ.get('PALETTE', 'mocha')
    game = Game(palette_name=palette)
    try:
        await game.run(complexity=20)
    finally:
        pygame.quit()


asyncio.run(main())
