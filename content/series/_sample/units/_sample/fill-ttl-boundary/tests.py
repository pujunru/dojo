from dojo import kc
from cache import TTLCache


@kc("_sample-ttl-boundary")
def test_alive_just_before_ttl(clock):
    c = TTLCache(10)
    c.put("k", "v")
    clock.advance(9.999)
    assert c.get("k") == "v"


@kc("_sample-ttl-boundary")
def test_gone_exactly_at_ttl(clock):
    c = TTLCache(10)
    c.put("k", "v")
    clock.advance(10)
    assert c.get("k") is None
