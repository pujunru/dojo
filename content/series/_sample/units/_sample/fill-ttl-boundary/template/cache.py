import time


class TTLCache:
    def __init__(self, ttl_seconds):
        self.ttl = ttl_seconds
        self._data = {}

    def put(self, key, value):
        self._data[key] = (value, time.monotonic() + self.ttl)

    def get(self, key, default=None):
        hit = self._data.get(key)
        if hit is None:
            return default
        value, expires_at = hit
        expired = # __BLANK:expired__
        if expired:
            del self._data[key]
            return default
        return value
