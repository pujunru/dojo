from dojo import kc, raises
from ledger import CreditLedger


@kc("_adv-bank-ledger", "_adv-extension-axis")
def test_transfer_moves_credits_between_teams():
    ledger = CreditLedger()
    ledger.grant("infra", 50)
    assert ledger.transfer("infra", "research", 20) is True
    assert ledger.balance("infra") == 30
    assert ledger.balance("research") == 20


@kc("_adv-bank-ledger")
def test_short_transfer_changes_nothing():
    ledger = CreditLedger()
    ledger.grant("infra", 5)
    assert ledger.transfer("infra", "research", 6) is False
    assert ledger.balance("infra") == 5
    assert ledger.history("research") == []


@kc("_adv-bank-ledger")
def test_transfer_to_self_is_an_error():
    ledger = CreditLedger()
    ledger.grant("infra", 5)
    with raises(ValueError):
        ledger.transfer("infra", "infra", 1)


@kc("_adv-extension-axis")
def test_history_lists_every_change_in_order():
    ledger = CreditLedger()
    ledger.grant("infra", 50)
    ledger.spend("infra", 5)
    ledger.transfer("infra", "research", 20)
    assert ledger.history("infra") == [("grant", 50), ("spend", -5), ("transfer_out", -20)]
    assert ledger.history("research") == [("transfer_in", 20)]


@kc("_adv-extension-axis", "_adv-bank-ledger")
def test_failed_operations_leave_no_history():
    ledger = CreditLedger()
    ledger.grant("infra", 3)
    ledger.spend("infra", 4)
    ledger.transfer("infra", "research", 4)
    assert ledger.history("infra") == [("grant", 3)]


@kc("_adv-extension-axis")
def test_history_of_unknown_team_is_empty():
    assert CreditLedger().history("nobody") == []
