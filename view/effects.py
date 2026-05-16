import math
import random

import pygame


class Particle:
    __slots__ = ('x', 'y', 'vx', 'vy', 'life', 'max_life',
                 'color', 'size', 'gravity', 'rot', 'spin')

    def __init__(self, x, y, vx, vy, color, life, size=4, gravity=520):
        self.x = float(x)
        self.y = float(y)
        self.vx = float(vx)
        self.vy = float(vy)
        self.life = float(life)
        self.max_life = float(life)
        self.color = color
        self.size = size
        self.gravity = gravity
        self.rot = random.uniform(0, 360)
        self.spin = random.uniform(-540, 540)

    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.vy += self.gravity * dt
        self.vx *= 0.94  # mild air drag
        self.rot += self.spin * dt
        self.life -= dt

    def alive(self):
        return self.life > 0

    def draw(self, surface):
        t = max(0.0, self.life / self.max_life)
        alpha = int(255 * t ** 0.6)
        s = max(1, int(self.size * (0.4 + 0.6 * t)))
        # Rotated square sprite
        spr = pygame.Surface((s * 2, s * 2), pygame.SRCALPHA)
        pygame.draw.rect(spr, (*self.color[:3], alpha), (0, 0, s * 2, s * 2))
        spr = pygame.transform.rotate(spr, self.rot)
        rect = spr.get_rect(center=(int(self.x), int(self.y)))
        surface.blit(spr, rect.topleft)


class Ghost:
    """Visual snapshot of a button that's playing the pop-out animation."""
    POP_DURATION = 0.17

    def __init__(self, rect, color, text, font, descent_shift=0):
        self.rect = pygame.Rect(rect)
        self.color = color or (90, 90, 90)
        self.text = text
        self.font = font
        self.descent_shift = descent_shift
        self.life = self.POP_DURATION
        self.max_life = self.POP_DURATION

    def update(self, dt):
        self.life -= dt

    def alive(self):
        return self.life > 0

    def draw(self, surface):
        t = 1 - max(0.0, self.life / self.max_life)  # 0 → 1
        # Quick scale-up then quick scale-down: 1.0 → 1.25 → 0.0
        if t < 0.35:
            scale = 1.0 + (0.25 * t / 0.35)
        else:
            scale = 1.25 * (1 - (t - 0.35) / 0.65)
        scale = max(0.01, scale)
        alpha = int(255 * (1 - t) ** 0.7)
        if alpha <= 0 or scale < 0.02:
            return

        sw = max(1, int(self.rect.w * scale))
        sh = max(1, int(self.rect.h * scale))
        spr = pygame.Surface((sw, sh), pygame.SRCALPHA)
        spr.fill((*self.color[:3], alpha))
        if self.text and self.font is not None and scale > 0.4:
            timg = self.font.render(self.text, True, (255, 255, 255))
            tw, th = timg.get_size()
            tx = (sw - tw) // 2
            ty = (sh - th) // 2 + self.descent_shift
            spr.blit(timg, (tx, ty))
        cx, cy = self.rect.center
        surface.blit(spr, (cx - sw // 2, cy - sh // 2))


class BigSpawn:
    """Pop-in animation overlay for a freshly resolved big cell."""
    DURATION = 0.32

    def __init__(self, button, snapshot):
        self.button = button
        self.snapshot = snapshot  # pygame.Surface of button rect size, opaque
        self.life = self.DURATION
        self.max_life = self.DURATION

    def update(self, dt):
        self.life -= dt

    def alive(self):
        return self.life > 0

    @property
    def scale(self):
        # 0.2 → 1.15 (overshoot) → 1.0 (settle)
        t = 1 - max(0.0, self.life / self.max_life)
        if t < 0.55:
            k = t / 0.55
            return 0.2 + (1.15 - 0.2) * (1 - (1 - k) ** 2)  # ease-out
        else:
            k = (t - 0.55) / 0.45
            return 1.15 - 0.15 * k

    def draw_on_top(self, surface):
        scale = self.scale
        rect = self.button.rect
        sw = max(1, int(rect.w * scale))
        sh = max(1, int(rect.h * scale))
        scaled = pygame.transform.smoothscale(self.snapshot, (sw, sh))
        cx, cy = rect.center
        surface.blit(scaled, (cx - sw // 2, cy - sh // 2))


class Effects:
    def __init__(self):
        self.particles = []
        self.ghosts = []
        self.big_spawns = []
        self.flashes = []
        self._shake_remaining = 0.0
        self._shake_total = 0.0
        self._shake_amp = 0.0
        self._shake_seed_x = 0
        self._shake_seed_y = 0
        self._shake_phase = 0.0

    # ------- camera shake -------
    def shake(self, amplitude, duration):
        if duration > self._shake_remaining or amplitude > self._shake_amp:
            self._shake_remaining = max(self._shake_remaining, duration)
            self._shake_total = max(self._shake_total, duration)
            self._shake_amp = max(self._shake_amp, amplitude)
            self._shake_seed_x = random.randint(0, 9999)
            self._shake_seed_y = random.randint(0, 9999)

    def shake_offset(self):
        if self._shake_remaining <= 0 or self._shake_amp <= 0:
            return 0, 0
        t = self._shake_remaining / self._shake_total
        amp = self._shake_amp * t
        ph = self._shake_phase
        # high-frequency oscillation that decays
        dx = int(math.sin(ph * 47 + self._shake_seed_x) * amp)
        dy = int(math.cos(ph * 53 + self._shake_seed_y) * amp)
        return dx, dy

    # ------- spawning -------
    def burst(self, x, y, color, count=14, speed=320, life_range=(0.45, 0.85), size=5):
        for _ in range(count):
            ang = random.uniform(0, math.tau)
            sp = random.uniform(speed * 0.4, speed)
            vx = math.cos(ang) * sp
            vy = math.sin(ang) * sp - random.uniform(20, 90)  # slight upward bias
            life = random.uniform(*life_range)
            self.particles.append(Particle(x, y, vx, vy, color, life, size=size))

    def small_pop(self, ghost, color):
        self.ghosts.append(ghost)
        cx, cy = ghost.rect.center
        self.burst(cx, cy, color, count=6, speed=180,
                   life_range=(0.25, 0.45), size=3)

    def big_pop(self, button, color, snapshot):
        self.big_spawns.append(BigSpawn(button, snapshot))
        cx, cy = button.rect.center
        self.burst(cx, cy, color, count=22, speed=420,
                   life_range=(0.6, 1.0), size=6)
        self.shake(amplitude=6, duration=0.22)

    def wrong_click(self, rect):
        """Red flash, shake, downward red particle spray for a wrong cell click."""
        self.flashes.append({'rect': pygame.Rect(rect),
                             'color': (220, 60, 60),
                             'life': 0.35, 'max': 0.35})
        cx, cy = rect.centerx, rect.centery
        for _ in range(10):
            ang = random.uniform(math.pi * 0.15, math.pi * 0.85)  # downward arc
            sp = random.uniform(140, 240)
            self.particles.append(Particle(
                cx, cy, math.cos(ang) * sp, math.sin(ang) * sp,
                (230, 80, 80), random.uniform(0.35, 0.55), size=3))
        self.shake(amplitude=4, duration=0.18)

    # ------- per-frame update -------
    def update(self, dt):
        if self._shake_remaining > 0:
            self._shake_remaining = max(0.0, self._shake_remaining - dt)
            self._shake_phase += dt
        for p in self.particles: p.update(dt)
        self.particles = [p for p in self.particles if p.alive()]
        for g in self.ghosts: g.update(dt)
        self.ghosts = [g for g in self.ghosts if g.alive()]
        for s in self.big_spawns: s.update(dt)
        self.big_spawns = [s for s in self.big_spawns if s.alive()]
        for f in self.flashes: f['life'] -= dt
        self.flashes = [f for f in self.flashes if f['life'] > 0]

    # ------- per-frame draw -------
    def draw_under(self, surface):
        """Draw ghosts (fading-out small cells)."""
        for g in self.ghosts:
            g.draw(surface)

    def draw_over(self, surface):
        """Draw big-cell pop-in scaling + flashes + particles on top of all."""
        for s in self.big_spawns:
            s.draw_on_top(surface)
        for f in self.flashes:
            t = max(0.0, f['life'] / f['max'])
            alpha = int(220 * t * t)
            r = f['rect']
            overlay = pygame.Surface(r.size, pygame.SRCALPHA)
            pygame.draw.rect(overlay, (*f['color'], alpha),
                             (0, 0, r.w, r.h), border_radius=10)
            surface.blit(overlay, r.topleft)
        for p in self.particles:
            p.draw(surface)

    def consumed_big_spawn_button(self, button):
        return any(s.button is button for s in self.big_spawns)
