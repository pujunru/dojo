from dojo import kc
from bank import Bank


def _bank():
    bank = Bank()
    bank.create_account("alice")
    bank.create_account("bob")
    bank.deposit("alice", 100)
    return bank


@kc("_adv-scheduled-events")
def test_payment_executes_once_its_time_arrives(clock):
    bank = _bank()
    assert bank.schedule_payment("alice", 30, 10) == "payment1"
    clock.advance(9)
    assert bank.deposit("alice", 0) == 100
    clock.advance(1)
    assert bank.deposit("alice", 0) == 70


@kc("_adv-scheduled-events")
def test_payments_due_together_run_in_creation_order(clock):
    bank = _bank()
    bank.schedule_payment("alice", 80, 5)
    bank.schedule_payment("alice", 50, 5)
    clock.advance(5)
    assert bank.deposit("alice", 0) == 20


@kc("_adv-scheduled-events", "_adv-bank-ledger")
def test_payment_without_funds_is_skipped(clock):
    bank = _bank()
    bank.schedule_payment("alice", 500, 1)
    clock.advance(2)
    assert bank.deposit("alice", 0) == 100
    assert bank.top_spenders(1) == ["alice(0)"]


@kc("_adv-scheduled-events")
def test_cancel_before_due_but_not_at_due_time(clock):
    bank = _bank()
    first = bank.schedule_payment("alice", 10, 5)
    second = bank.schedule_payment("alice", 10, 5)
    assert bank.cancel_payment("bob", first) is False
    assert bank.cancel_payment("alice", first) is True
    clock.advance(5)
    assert bank.cancel_payment("alice", second) is False
    assert bank.deposit("alice", 0) == 90


@kc("_adv-scheduled-events", "_adv-top-k-ties")
def test_executed_payments_count_as_outgoing(clock):
    bank = _bank()
    bank.schedule_payment("alice", 25, 3)
    bank.schedule_payment("bob", 1, 1)
    assert bank.schedule_payment("carol", 1, 1) is None
    clock.advance(3)
    assert bank.top_spenders(2) == ["alice(25)", "bob(0)"]
