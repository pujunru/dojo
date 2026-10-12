class CreditLedger:
    """GPU credits per team."""

    def __init__(self):
        self.balances: dict[str, int] = {}

    def grant(self, team: str, credits: int) -> int:
        if credits <= 0:
            raise ValueError("credits must be positive")
        self.balances[team] = self.balances.get(team, 0) + credits
        return self.balances[team]

    def spend(self, team: str, credits: int) -> bool:
        if credits <= 0:
            raise ValueError("credits must be positive")
        current = self.balances.get(team, 0)
        if current < credits:
            return False
        self.balances[team] = current - credits
        return True

    def balance(self, team: str) -> int:
        return self.balances.get(team, 0)
