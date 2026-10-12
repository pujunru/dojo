from dojo import kc, raises
from ledger import CreditLedger


@kc("_adv-bank-ledger")
def test_grant_returns_the_new_balance():
    ledger = CreditLedger()
    assert ledger.grant("infra", 40) == 40
    assert ledger.grant("infra", 2) == 42


@kc("_adv-bank-ledger")
def test_spend_refuses_more_than_the_balance():
    ledger = CreditLedger()
    ledger.grant("infra", 10)
    assert ledger.spend("infra", 11) is False
    assert ledger.spend("infra", 10) is True
    assert ledger.balance("infra") == 0


@kc("_adv-bank-ledger")
def test_non_positive_credits_are_rejected():
    ledger = CreditLedger()
    with raises(ValueError):
        ledger.grant("infra", 0)
    with raises(ValueError):
        ledger.spend("infra", -1)


@kc("_adv-bank-ledger")
def test_unknown_team_has_zero_balance():
    assert CreditLedger().balance("nobody") == 0
