"""Visual effects: particles, shockwave rings, pop-in animations, camera
shake and a screen vignette.

Design goal — "juice": every action should answer back with motion, light
and a little overshoot, but stay cheap enough for the wasm/web build.
Cheap tricks used here: additive blits for glow, eased overshoot curves,
and short particle lifetimes so counts never pile up.
"""
import math
import random

import pygame

from view.anim import clamp01, ease_out_cubic, ease_out_back, ease_out_quad


def _brighten(color, amount):
    return tuple(max(0, min(255, c + amount)) for c in color[:3])


class Particle:
    __slots__ = ('x', 'y', 'vx', 'vy', 'life', 'max_life', 'color', 'size',
                 'gravity', 'drag', 'rot', 'spin', 'shape', 'seed')

    def __init__(self, x, y, vx, vy, color, life, size=4, gravity=520,
                 drag=0.94, shape='chunk'):
        self.x = float(x)
        self.y = float(y)
        self.vx = float(vx)
        self.vy = float(vy)
        self.life = float(life)
        self.max_life = float(life)
        self.color = color[:3]
        self.size = size
        self.gravity = gravity
        self.drag = drag
        self.rot = random.uniform(0, 360)
        self.spin = random.uniform(-540, 540)
        self.shape = shape
        self.seed = random.uniform(0, 6.28)

    def update(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.vy += self.gravity * dt
        self.vx *= self.drag
        self.rot += self.spin * dt
        self.life -= dt

    def alive(self):
        return self.life > 0

    def draw(self, surface):
        t = max(0.0, self.life / self.max_life)
        if self.shape == 'spark':
            self._draw_spark(surface, t)
        elif self.shape == 'confetti':
            self._draw_confetti(surface, t)
        else:
            self._draw_chunk(surface, t)

    def _draw_chunk(self, surface, t):
        alpha = int(255 * t ** 0.6)
        s = max(1, int(self.size * (0.35 + 0.65 * t)))
        spr = pygame.Surface((s * 2, s * 2), pygame.SRCALPHA)
        pygame.draw.rect(spr, (*self.color, alpha), (0, 0, s * 2, s * 2),
                         border_radius=max(1, s // 3))
        spr = pygame.transform.rotate(spr, self.rot)
        surface.blit(spr, spr.get_rect(center=(int(self.x), int(self.y))))

    def _draw_spark(self, surface, t):
        # additive twinkling glow dot — the brightest, snappiest particle
        twinkle = 0.7 + 0.3 * math.sin(self.seed + (1.0 - t) * 22.0)
        r = max(1.0, self.size * (0.35 + 0.65 * t) * twinkle)
        alpha = int(235 * t ** 0.45)
        d = int(r * 4)
        if d < 2:
            return
        spr = pygame.Surface((d, d), pygame.SRCALPHA)
        c = (int(d / 2), int(d / 2))
        pygame.draw.circle(spr, (*_brighten(self.color, 60), alpha // 3),
                           c, int(r * 2))
        pygame.draw.circle(spr, (*_brighten(self.color, 90), alpha), c,
                           max(1, int(r)))
        surface.blit(spr, spr.get_rect(center=(int(self.x), int(self.y))),
                     special_flags=pygame.BLEND_RGBA_ADD)

    def _draw_confetti(self, surface, t):
        alpha = int(255 * min(1.0, t * 3.0))
        w = max(2, int(self.size))
        h = max(2, int(self.size * 0.45))
        spr = pygame.Surface((w, h), pygame.SRCALPHA)
        spr.fill((*self.color, alpha))
        # fake the paper "flip" by squashing on a sine of the rotation
        flip = abs(math.sin(math.radians(self.rot)))
        spr = pygame.transform.rotozoom(spr, self.rot * 0.3,
                                        0.35 + 0.65 * flip)
        surface.blit(spr, spr.get_rect(center=(int(self.x), int(self.y))))


class Ring:
    """Expanding stroked ring — a shockwave."""

    def __init__(self, x, y, color, max_radius, life=0.4, width=4,
                 start_radius=2):
        self.x = x
        self.y = y
        self.color = color[:3]
        self.max_radius = max_radius
        self.start_radius = start_radius
        self.life = life
        self.max_life = life
        self.width = width

    def update(self, dt):
        self.life -= dt

    def alive(self):
        return self.life > 0

    def draw(self, surface):
        t = 1.0 - clamp01(self.life / self.max_life)
        radius = self.start_radius + (self.max_radius - self.start_radius) * \
            ease_out_cubic(t)
        alpha = int(220 * (1.0 - t) ** 1.5)
        if alpha <= 0 or radius < 1:
            return
        width = max(1, int(self.width * (1.0 - t * 0.7)))
        d = int(radius * 2 + width * 2 + 4)
        spr = pygame.Surface((d, d), pygame.SRCALPHA)
        pygame.draw.circle(spr, (*_brighten(self.color, 70), alpha),
                           (d // 2, d // 2), int(radius), width)
        surface.blit(spr, spr.get_rect(center=(int(self.x), int(self.y))),
                     special_flags=pygame.BLEND_RGBA_ADD)


class Ghost:
    """Visual snapshot of a small tile playing its pop-out animation."""
    POP_DURATION = 0.19

    def __init__(self, rect, color, text, font, descent_shift=0):
        self.rect = pygame.Rect(rect)
        self.color = (color or (90, 90, 90))[:3]
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
        t = 1.0 - max(0.0, self.life / self.max_life)
        # punch up then collapse: a quick squash-and-pop
        if t < 0.3:
            scale = 1.0 + 0.30 * (t / 0.3)
        else:
            scale = 1.30 * (1.0 - ease_out_quad((t - 0.3) / 0.7))
        scale = max(0.01, scale)
        alpha = int(255 * (1.0 - t) ** 0.7)
        if alpha <= 0 or scale < 0.03:
            return
        sw = max(1, int(self.rect.w * scale))
        sh = max(1, int(self.rect.h * scale))
        spr = pygame.Surface((sw, sh), pygame.SRCALPHA)
        pygame.draw.rect(spr, (*_brighten(self.color, 25), alpha),
                         (0, 0, sw, sh), border_radius=max(2, sw // 5))
        if self.text and self.font is not None and scale > 0.45:
            timg = self.font.render(self.text, True, (255, 255, 255))
            tw, th = timg.get_size()
            spr.blit(timg, ((sw - tw) // 2,
                            (sh - th) // 2 + self.descent_shift))
        cx, cy = self.rect.center
        surface.blit(spr, (cx - sw // 2, cy - sh // 2))


class BigSpawn:
    """Pop-in overlay for a freshly resolved big cell — eased overshoot."""
    DURATION = 0.34

    def __init__(self, button, snapshot):
        self.button = button
        self.snapshot = snapshot
        self.life = self.DURATION
        self.max_life = self.DURATION

    def update(self, dt):
        self.life -= dt

    def alive(self):
        return self.life > 0

    @property
    def scale(self):
        t = 1.0 - max(0.0, self.life / self.max_life)
        return 0.30 + 0.70 * ease_out_back(t, overshoot=2.2)

    def draw_on_top(self, surface):
        scale = self.scale
        t = 1.0 - max(0.0, self.life / self.max_life)
        rect = self.button.rect
        sw = max(1, int(rect.w * scale))
        sh = max(1, int(rect.h * scale))
        scaled = pygame.transform.smoothscale(self.snapshot, (sw, sh))
        cx, cy = rect.center
        surface.blit(scaled, (cx - sw // 2, cy - sh // 2))
        # bright bloom in the first third of the animation
        if t < 0.4:
            glow = int(150 * (1.0 - t / 0.4))
            bloom = pygame.Surface((sw, sh), pygame.SRCALPHA)
            pygame.draw.rect(bloom, (255, 255, 255, glow), (0, 0, sw, sh),
                             border_radius=12)
            surface.blit(bloom, (cx - sw // 2, cy - sh // 2),
                         special_flags=pygame.BLEND_RGBA_ADD)


class Effects:
    def __init__(self, bounds=(960, 728)):
        self.particles = []
        self.ghosts = []
        self.big_spawns = []
        self.rings = []
        self.flashes = []
        # big-cell pops waiting on a stagger delay, so a chain of cells
        # resolved at once appears as a cascade rather than all together
        self._pending_pops = []
        self.bounds = bounds
        self.theme_colors = [(231, 111, 81), (244, 162, 97), (233, 196, 106),
                             (138, 177, 167), (98, 122, 167), (114, 80, 124)]
        self._shake_remaining = 0.0
        self._shake_total = 0.0
        self._shake_amp = 0.0
        self._shake_seed_x = 0
        self._shake_seed_y = 0
        self._shake_phase = 0.0
        # vignette
        self._vig_color = (220, 60, 60)
        self._vig_hold = 0.0
        self._vig_hold_target = 0.0
        self._vig_pulse = 0.0
        self._vig_cache = {}

    # ------------------------------------------------------------------
    def set_theme_colors(self, colors):
        if colors:
            self.theme_colors = [c[:3] for c in colors]

    def clear(self):
        self.particles.clear()
        self.ghosts.clear()
        self.big_spawns.clear()
        self.rings.clear()
        self.flashes.clear()
        self._pending_pops.clear()
        self._shake_remaining = 0.0
        self._shake_amp = 0.0
        self._vig_hold = self._vig_hold_target = 0.0
        self._vig_pulse = 0.0

    def calm(self):
        """Let particles finish, but fade out any sustained vignette/shake."""
        self._vig_hold_target = 0.0
        self._vig_pulse = 0.0
        self._shake_remaining = 0.0
        self._shake_amp = 0.0

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
        amp = self._shake_amp * (t * t)  # quadratic decay reads "snappier"
        ph = self._shake_phase
        dx = int(math.sin(ph * 47 + self._shake_seed_x) * amp)
        dy = int(math.cos(ph * 53 + self._shake_seed_y) * amp)
        return dx, dy

    # ------- spawning -------
    def burst(self, x, y, color, count=14, speed=320, life_range=(0.45, 0.85),
              size=5, spark_ratio=0.4, gravity=520, up_bias=(20, 90)):
        for i in range(count):
            ang = random.uniform(0, math.tau)
            sp = random.uniform(speed * 0.35, speed)
            vx = math.cos(ang) * sp
            vy = math.sin(ang) * sp - random.uniform(*up_bias)
            life = random.uniform(*life_range)
            shape = 'spark' if random.random() < spark_ratio else 'chunk'
            psize = size * (1.4 if shape == 'spark' else 1.0)
            self.particles.append(Particle(x, y, vx, vy, color, life,
                                           size=psize, gravity=gravity,
                                           shape=shape))

    def small_pop(self, ghost, color):
        self.ghosts.append(ghost)
        cx, cy = ghost.rect.center
        self.burst(cx, cy, color, count=7, speed=210,
                   life_range=(0.22, 0.42), size=3, spark_ratio=0.55)
        self.rings.append(Ring(cx, cy, color, max_radius=26, life=0.28,
                               width=3))

    def big_pop(self, button, color, snapshot, delay=0.0):
        # a delayed pop is parked until its timer elapses — the cell stays
        # hidden meanwhile (see consumed_big_spawn_button), then bursts in
        if delay > 0.0:
            self._pending_pops.append({'t': delay, 'button': button,
                                       'color': color, 'snap': snapshot})
            return
        self.big_spawns.append(BigSpawn(button, snapshot))
        cx, cy = button.rect.center
        self.burst(cx, cy, color, count=20, speed=430,
                   life_range=(0.55, 1.0), size=6, spark_ratio=0.45)
        self.rings.append(Ring(cx, cy, color, max_radius=92, life=0.46,
                               width=6))
        self.rings.append(Ring(cx, cy, (255, 255, 255), max_radius=58,
                               life=0.32, width=3))
        self.flashes.append({'rect': pygame.Rect(button.rect),
                             'color': (255, 255, 255), 'life': 0.22,
                             'max': 0.22, 'radius': 12, 'add': True})
        self.shake(amplitude=7, duration=0.24)

    def wrong_click(self, rect):
        """Red flash, shake, downward red spray, edge vignette pulse."""
        self.flashes.append({'rect': pygame.Rect(rect),
                             'color': (224, 64, 64), 'life': 0.38,
                             'max': 0.38, 'radius': 10, 'add': False})
        cx, cy = rect.centerx, rect.centery
        for _ in range(12):
            ang = random.uniform(math.pi * 0.12, math.pi * 0.88)
            sp = random.uniform(150, 280)
            self.particles.append(Particle(
                cx, cy, math.cos(ang) * sp, math.sin(ang) * sp,
                (232, 84, 84), random.uniform(0.35, 0.6), size=4,
                shape='spark' if random.random() < 0.4 else 'chunk'))
        self.rings.append(Ring(cx, cy, (232, 84, 84), max_radius=70,
                               life=0.34, width=4))
        self.shake(amplitude=9, duration=0.32)
        self._vig_color = (220, 55, 55)
        self._vig_pulse = max(self._vig_pulse, 0.6)

    def heart_break(self, x, y):
        """Burst played when a life is lost."""
        for _ in range(10):
            ang = random.uniform(0, math.tau)
            sp = random.uniform(80, 230)
            self.particles.append(Particle(
                x, y, math.cos(ang) * sp, math.sin(ang) * sp,
                (228, 78, 92), random.uniform(0.4, 0.7), size=4,
                gravity=640,
                shape='spark' if random.random() < 0.4 else 'chunk'))
        self.rings.append(Ring(x, y, (228, 78, 92), max_radius=34,
                               life=0.32, width=3))

    def confetti(self, count=46):
        """A burst of falling paper — used by the win screen."""
        w, h = self.bounds
        for _ in range(count):
            x = random.uniform(0, w)
            y = random.uniform(-60, -4)
            vx = random.uniform(-70, 70)
            vy = random.uniform(60, 170)
            color = random.choice(self.theme_colors + [
                (255, 226, 130), (255, 255, 255)])
            p = Particle(x, y, vx, vy, color, random.uniform(2.6, 4.2),
                         size=random.uniform(8, 15), gravity=70, drag=0.995,
                         shape='confetti')
            p.spin = random.uniform(-260, 260)
            self.particles.append(p)

    def celebrate(self):
        """Win flourish: a gold shockwave plus a sparkle fountain."""
        w, h = self.bounds
        cx, cy = w // 2, h // 2
        self.rings.append(Ring(cx, cy, (255, 214, 120), max_radius=420,
                               life=0.8, width=8))
        self.rings.append(Ring(cx, cy, (255, 255, 255), max_radius=300,
                               life=0.6, width=4))
        for _ in range(26):
            ang = random.uniform(-math.pi, 0)
            sp = random.uniform(260, 560)
            self.particles.append(Particle(
                cx, cy, math.cos(ang) * sp, math.sin(ang) * sp,
                random.choice([(255, 214, 120), (255, 246, 210),
                               (255, 255, 255)]),
                random.uniform(0.7, 1.3), size=6, gravity=420,
                shape='spark'))
        self.confetti(60)

    def defeat(self):
        """Lose flourish: a heavy thud, dark-red vignette settles in."""
        self.shake(amplitude=13, duration=0.5)
        self._vig_color = (150, 30, 34)
        self._vig_hold_target = 0.5
        self._vig_pulse = max(self._vig_pulse, 0.75)

    # ------- per-frame update -------
    def update(self, dt):
        if self._shake_remaining > 0:
            self._shake_remaining = max(0.0, self._shake_remaining - dt)
            self._shake_phase += dt
        # release any staggered big-cell pops whose delay has elapsed
        if self._pending_pops:
            for pp in self._pending_pops:
                pp['t'] -= dt
            due = [pp for pp in self._pending_pops if pp['t'] <= 0.0]
            self._pending_pops = [pp for pp in self._pending_pops
                                  if pp['t'] > 0.0]
            for pp in due:
                self.big_pop(pp['button'], pp['color'], pp['snap'])
        for p in self.particles:
            p.update(dt)
        self.particles = [p for p in self.particles
                          if p.alive() and p.y < self.bounds[1] + 80]
        for g in self.ghosts:
            g.update(dt)
        self.ghosts = [g for g in self.ghosts if g.alive()]
        for s in self.big_spawns:
            s.update(dt)
        self.big_spawns = [s for s in self.big_spawns if s.alive()]
        for r in self.rings:
            r.update(dt)
        self.rings = [r for r in self.rings if r.alive()]
        for f in self.flashes:
            f['life'] -= dt
        self.flashes = [f for f in self.flashes if f['life'] > 0]
        # vignette easing
        self._vig_pulse = max(0.0, self._vig_pulse - dt * 2.6)
        sp = 4.0 * dt
        self._vig_hold += (self._vig_hold_target - self._vig_hold) * min(1, sp)

    # ------- per-frame draw -------
    def draw_under(self, surface):
        for g in self.ghosts:
            g.draw(surface)

    def draw_over(self, surface):
        for s in self.big_spawns:
            s.draw_on_top(surface)
        for f in self.flashes:
            t = max(0.0, f['life'] / f['max'])
            r = f['rect']
            overlay = pygame.Surface(r.size, pygame.SRCALPHA)
            if f.get('add'):
                alpha = int(170 * t)
                pygame.draw.rect(overlay, (*f['color'], alpha),
                                 (0, 0, r.w, r.h),
                                 border_radius=f.get('radius', 10))
                surface.blit(overlay, r.topleft,
                             special_flags=pygame.BLEND_RGBA_ADD)
            else:
                alpha = int(210 * t * t)
                pygame.draw.rect(overlay, (*f['color'], alpha),
                                 (0, 0, r.w, r.h),
                                 border_radius=f.get('radius', 10))
                surface.blit(overlay, r.topleft)
        for r in self.rings:
            r.draw(surface)
        for p in self.particles:
            p.draw(surface)

    def draw_vignette(self, surface):
        level = max(self._vig_hold, self._vig_pulse)
        if level <= 0.01:
            return
        vig = self._get_vignette(surface.get_size(), self._vig_color)
        vig.set_alpha(int(235 * clamp01(level)))
        surface.blit(vig, (0, 0))

    def _get_vignette(self, size, color):
        key = (size, tuple(color))
        cached = self._vig_cache.get(key)
        if cached is not None:
            return cached
        w, h = size
        sw, sh = max(2, w // 5), max(2, h // 5)
        small = pygame.Surface((sw, sh), pygame.SRCALPHA)
        cx, cy = sw / 2.0, sh / 2.0
        maxd = math.hypot(cx, cy)
        for yy in range(sh):
            for xx in range(sw):
                d = math.hypot(xx - cx, yy - cy) / maxd
                a = int(255 * clamp01((d - 0.42) / 0.58) ** 1.6)
                if a:
                    small.set_at((xx, yy), (*color, a))
        vig = pygame.transform.smoothscale(small, (w, h))
        self._vig_cache[key] = vig
        return vig

    def consumed_big_spawn_button(self, button):
        # True while a pop is playing *or* still parked — either way the
        # static cell must stay hidden until the pop animation takes over
        return (any(s.button is button for s in self.big_spawns)
                or any(pp['button'] is button for pp in self._pending_pops))

    @property
    def busy(self):
        return bool(self.particles or self.rings or self.big_spawns
                    or self.ghosts or self._pending_pops)
