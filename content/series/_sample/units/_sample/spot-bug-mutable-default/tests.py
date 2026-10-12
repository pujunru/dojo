from dojo import kc
from inventory import pack


@kc("_sample-mutable-default")
def test_two_orders_do_not_share_a_bag():
    assert pack(["tent"]) == ["tent"]
    assert pack(["stove", "pot"]) == ["stove", "pot"]
