class CreditLedger:
    def __init__(self):
        self.balances: dict[str, int] = {}
        self.entries: dict[str, list[tuple[str, int]]] = {}

    def grant(self, team, credits):
        if credits <= 0:
            raise ValueError("credits must be positive")
        self.balances[team] = self.balances.get(team, 0) + credits
        self.entries.setdefault(team, []).append(("grant", credits))
        return self.balances[team]

    def spend(self, team, credits):
        if credits <= 0:
            raise ValueError("credits must be positive")
        if self.balance(team) < credits:
            return False
        self.balances[team] -= credits
        self.entries.setdefault(team, []).append(("spend", -credits))
        return True

    def transfer(self, source, target, credits):
        if credits <= 0 or source == target:
            raise ValueError("bad transfer")
        if self.balance(source) < credits:
            return False
        self.balances[source] -= credits
        self.balances[target] = self.balance(target) + credits
        self.entries.setdefault(source, []).append(("transfer_out", -credits))
        return True

    def balance(self, team):
        return self.balances.get(team, 0)

    def history(self, team):
        return list(self.entries.get(team, []))
