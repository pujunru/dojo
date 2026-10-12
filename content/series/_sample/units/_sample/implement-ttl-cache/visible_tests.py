from dojo import kc
from cache import TTLCache


@kc("_sample-ttl-boundary")
def test_get_returns_value_before_expiry(clock):
    c = TTLCache(5)
    c.put("a", 1)
    clock.advance(4)
    assert c.get("a") == 1
