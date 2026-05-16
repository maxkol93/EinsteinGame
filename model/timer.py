class Timer(object):
    def __init__(self, delegate, handler):
        self._stopped = False
        self._value = 0
        self._accumulator_ms = 0
        self._delegate_timer_update_in_view = delegate
        self._end_game_handler = handler

    def start(self):
        self._stopped = False
        self._value = 0
        self._accumulator_ms = 0
        self._delegate_timer_update_in_view(self._value)

    def tick(self, dt_ms):
        if self._stopped:
            return
        self._accumulator_ms += dt_ms
        while self._accumulator_ms >= 1000:
            self._accumulator_ms -= 1000
            self._value += 1
            self._delegate_timer_update_in_view(self._value)

    def stop_timer(self):
        if not self._stopped:
            self._stopped = True
            self._end_game_handler()

    @property
    def value(self):
        return self._value

    @property
    def stopped(self):
        return self._stopped
