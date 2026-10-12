from dojo import kc
from bank import Bank


def _bank():
    bank = Bank()
    for account_id in ("alice", "bob", "carol", "dave"):
        bank.create_account(account_id)
        bank.deposit(account_id, 100)
    return bank


@kc("_adv-top-k-ties")
def test_top_spenders_orders_by_outgoing_total():
    bank = _bank()
    bank.transfer("alice", "bob", 10)
    bank.transfer("carol", "bob", 40)
    bank.transfer("alice", "dave", 20)
    assert bank.top_spenders(2) == ["carol(40)", "alice(30)"]


@kc("_adv-top-k-ties")
def test_top_spenders_breaks_ties_by_account_id():
    bank = _bank()
    bank.transfer("dave", "alice", 15)
    bank.transfer("bob", "alice", 15)
    assert bank.top_spenders(3) == ["bob(15)", "dave(15)", "alice(0)"]


@kc("_adv-top-k-ties", "_adv-bank-ledger")
def test_incoming_money_and_failed_transfers_do_not_count():
    bank = _bank()
    bank.transfer("alice", "bob", 500)
    bank.transfer("bob", "carol", 5)
    assert bank.top_spenders(1) == ["bob(5)"]


@kc("_adv-top-k-ties")
def test_top_spenders_returns_everyone_when_n_is_large():
    bank = _bank()
    assert bank.top_spenders(10) == ["alice(0)", "bob(0)", "carol(0)", "dave(0)"]
