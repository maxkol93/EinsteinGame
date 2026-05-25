# -*- coding: utf-8 -*-
"""Best-effort clipboard write.

Used by the "share result" button. On the web build it goes through the
browser's clipboard API; on the desktop through pygame.scrap. Either path may
be unavailable — the call simply reports False and the game carries on.

On itch.io the Clipboard API is sometimes blocked by the iframe's
``Permissions-Policy`` header; we fall back to an off-screen ``<textarea>``
+ ``document.execCommand('copy')``, which still works in that environment.
"""
import sys

import pygame

_IS_WEB = sys.platform == 'emscripten'


def _web_writetext(text):
    import platform
    promise = platform.window.navigator.clipboard.writeText(text)
    # writeText returns a Promise that, inside an itch iframe, *rejects
    # asynchronously* when the Clipboard API is blocked by Permissions-Policy.
    # Nothing is raised here, so the Python try/except never sees it and an
    # unhandled "Rejection occurred" surfaces in the console. Swallow it.
    try:
        promise.catch(lambda _err: None)
    except Exception:
        pass


def _web_execcommand_fallback(text):
    """Older path that works inside sandboxed/permissions-restricted iframes.

    Creates a hidden ``<textarea>``, selects it, runs ``execCommand('copy')``
    and removes the element. ``execCommand`` is deprecated but still ships
    in all current browsers and is what most "copy" buttons fall back to.
    """
    import platform
    doc = platform.document
    ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    style = ta.style
    style.position = 'fixed'
    style.top = '-1000px'
    style.left = '-1000px'
    style.opacity = '0'
    doc.body.appendChild(ta)
    try:
        ta.focus()
        ta.select()
        ok = bool(doc.execCommand('copy'))
    finally:
        doc.body.removeChild(ta)
    return ok


def copy_to_clipboard(text):
    """Put `text` on the system clipboard. Returns True on success."""
    text = str(text)
    if _IS_WEB:
        # Try the synchronous execCommand path first: it actually works inside
        # the permissions-restricted itch iframe, and unlike writeText it
        # reports success/failure right here instead of rejecting a Promise
        # later (which used to throw an unhandled "Rejection occurred").
        try:
            if _web_execcommand_fallback(text):
                return True
        except Exception:
            pass
        try:
            _web_writetext(text)
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
