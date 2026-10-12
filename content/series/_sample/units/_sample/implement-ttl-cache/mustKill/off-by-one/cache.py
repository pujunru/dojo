import time


class TTLCache:
    """In-memory key-value store whose entries expire `ttl_seconds` after their last write."""

    def __init__(self, ttl_seconds):
        self.ttl = ttl_seconds
        self._data = {}

    def put(self, key, value):
        self._data[key] = (value, time.monotonic() + self.ttl)

    def _alive(self, key):
        hit = self._data.get(key)
        if hit is None:
            return None
        if time.monotonic() > hit[1]:
            del self._data[key]
            return None
        return hit

    def get(self, key, default=None):
        hit = self._alive(key)
        return default if hit is None else hit[0]

    def __len__(self):
        for key in list(self._data):
            self._alive(key)
        return len(self._data)
