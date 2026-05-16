import asyncio
import os

import pygame

from presenter.game import Game


async def main():
    pygame.init()
    pygame.display.set_caption('Einstein game')
    palette = os.environ.get('PALETTE', 'mocha')
    game = Game(palette_name=palette)
    try:
        await game.run(complexity=20)
    finally:
        pygame.quit()


asyncio.run(main())
