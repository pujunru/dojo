from dojo import kc
from bank import Bank


@kc("_adv-bank-ledger")
def test_create_account_rejects_duplicates():
    bank = Bank()
    assert bank.create_account("alice") is True
    assert bank.create_account("alice") is False


@kc("_adv-bank-ledger")
def test_deposit_returns_new_balance():
    bank = Bank()
    bank.create_account("alice")
    assert bank.deposit("alice", 50) == 50
    assert bank.deposit("alice", 25) == 75
    assert bank.deposit("bob", 10) is None


@kc("_adv-bank-ledger")
def test_transfer_moves_money_and_returns_source_balance():
    bank = Bank()
    bank.create_account("alice")
    bank.create_account("bob")
    bank.deposit("alice", 100)
    assert bank.transfer("alice", "bob", 30) == 70
    assert bank.deposit("bob", 0) == 30


@kc("_adv-bank-ledger")
def test_failed_transfer_changes_nothing():
    bank = Bank()
    bank.create_account("alice")
    bank.create_account("bob")
    bank.deposit("alice", 20)
    assert bank.transfer("alice", "bob", 21) is None
    assert bank.transfer("alice", "alice", 5) is None
    assert bank.transfer("alice", "carol", 5) is None
    assert bank.deposit("alice", 0) == 20
    assert bank.deposit("bob", 0) == 0
