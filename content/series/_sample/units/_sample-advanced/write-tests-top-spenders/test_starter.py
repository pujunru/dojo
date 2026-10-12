from spenders import top_spenders


def test_orders_by_total_outgoing():
    transfers = [("alice", "bob", 10), ("carol", "bob", 40)]
    assert top_spenders(transfers, ["alice", "bob", "carol"], 2) == ["carol(40)", "alice(10)"]


# Add tests below: each wrong implementation must fail at least one of them.
