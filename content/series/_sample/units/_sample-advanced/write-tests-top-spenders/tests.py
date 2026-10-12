from dojo import kc
from spenders import top_spenders


@kc("_adv-top-k-ties")
def test_orders_by_total_outgoing():
    transfers = [("alice", "bob", 10), ("carol", "bob", 40)]
    assert top_spenders(transfers, ["alice", "bob", "carol"], 2) == ["carol(40)", "alice(10)"]


@kc("_adv-top-k-ties")
def test_ties_break_by_id_ascending():
    transfers = [("dave", "alice", 15), ("bob", "alice", 15)]
    assert top_spenders(transfers, ["alice", "bob", "dave"], 2) == ["bob(15)", "dave(15)"]


@kc("_adv-mutation-thinking")
def test_returns_exactly_n():
    assert len(top_spenders([], ["a", "b", "c"], 2)) == 2


@kc("_adv-top-k-ties")
def test_sums_repeated_transfers():
    transfers = [("alice", "bob", 10), ("alice", "bob", 5), ("bob", "alice", 12)]
    assert top_spenders(transfers, ["alice", "bob"], 1) == ["alice(15)"]


@kc("_adv-mutation-thinking")
def test_zero_spenders_still_rank():
    assert top_spenders([], ["b", "a"], 5) == ["a(0)", "b(0)"]
