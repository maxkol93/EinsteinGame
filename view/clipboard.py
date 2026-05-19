# -*- coding: utf-8 -*-
"""Best-effort clipboard write.

Used by the "share result" button. On the web build it goes through the
browser's clipboard API; on the desktop through pygame.scrap. Either path may
be unavailable — the call simply reports False and the game carries on.
"""
import sys

import pygame

_IS_WEB = sys.platform == 'emscripten'


def copy_to_clipboard(text):
    """Put `text` on the system clipboard. Returns True on success."""
    text = str(text)
    if _IS_WEB:
        try:
            import platform
            platform.window.navigator.clipboard.writeText(text)
            return True
        except Exception:
            return False
    try:
        if not pygame.scrap.get_init():
            pygame.scrap.init()
        pygame.scrap.put(pygame.SCRAP_TEXT, text.encode('utf-8'))
        return True
    except Exception:
        return False
