from dojo import kc
from cache import TTLCache


@kc("_sample-ttl-boundary")
def test_expires_exactly_at_ttl(clock):
    c = TTLCache(5)
    c.put("a", 1)
    clock.advance(5)
    assert c.get("a") is None


@kc("_sample-ttl-boundary", "_sample-clock-injection")
def test_rewrite_refreshes_ttl(clock):
    c = TTLCache(5)
    c.put("a", 1)
    clock.advance(4)
    c.put("a", 2)
    clock.advance(4)
    assert c.get("a") == 2


@kc("_sample-ttl-boundary")
def test_missing_key_returns_default():
    c = TTLCache(5)
    assert c.get("nope", "dflt") == "dflt"


@kc("_sample-ttl-boundary")
def test_len_counts_only_live_entries(clock):
    c = TTLCache(5)
    c.put("a", 1)
    clock.advance(3)
    c.put("b", 2)
    clock.advance(2)
    assert len(c) == 1
