import asyncio

import pygame

from presenter.game import Game
from view.window import CANVAS_WIDTH, CANVAS_HEIGHT


async def main():
    # A 1024-sample buffer is the sweet spot: still snappy for UI SFX, but
    # large enough that the wasm/web audio thread does not underrun (a 512
    # buffer crackles badly there). Both calls are wrapped: a machine with
    # no audio device must still run the game.
    try:
        pygame.mixer.pre_init(44100, -16, 2, 1024)
    except pygame.error:
        pass
    pygame.init()
    try:
        pygame.mixer.init()
    except pygame.error:
        pass
    pygame.display.set_caption('Einstein game')
    pygame.display.set_mode((CANVAS_WIDTH, CANVAS_HEIGHT))

    game = Game()
    try:
        await game.run()
    finally:
        pygame.quit()


asyncio.run(main())
