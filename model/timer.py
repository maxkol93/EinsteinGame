import time
from threading import Thread

class Timer(Thread):
    def __init__(self, delegate, handler):
        super(Timer, self).__init__()
        self.daemon = True
        self._stop = False
        self._value = 0
        self._delegate_timer_update_in_view = delegate
        self._end_game_hanler = handler

    def run(self):
        while not self._stop:
            self._delegate_timer_update_in_view(self._value)
            self._value += 1
            time.sleep(1)
        self._end_game_hanler()

    def stop_timer(self):
        self._stop = True
        self._Thread__stop()