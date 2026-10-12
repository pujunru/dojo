import time


class TTLCache:
    """In-memory key-value store whose entries expire `ttl_seconds` after their last write."""

    def __init__(self, ttl_seconds):
        raise NotImplementedError

    def put(self, key, value):
        raise NotImplementedError

    def get(self, key, default=None):
        raise NotImplementedError

    def __len__(self):
        """Number of live (unexpired) entries."""
        raise NotImplementedError
