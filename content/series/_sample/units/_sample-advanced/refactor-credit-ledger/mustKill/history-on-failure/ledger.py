class CreditLedger:
    def __init__(self):
        self.balances: dict[str, int] = {}
        self.entries: dict[str, list[tuple[str, int]]] = {}

    def _record(self, team, kind, delta):
        self.entries.setdefault(team, []).append((kind, delta))

    def grant(self, team, credits):
        if credits <= 0:
            raise ValueError("credits must be positive")
        self.balances[team] = self.balances.get(team, 0) + credits
        self._record(team, "grant", credits)
        return self.balances[team]

    def spend(self, team, credits):
        if credits <= 0:
            raise ValueError("credits must be positive")
        self._record(team, "spend", -credits)
        if self.balance(team) < credits:
            return False
        self.balances[team] -= credits
        return True

    def transfer(self, source, target, credits):
        if credits <= 0 or source == target:
            raise ValueError("bad transfer")
        self._record(source, "transfer_out", -credits)
        if self.balance(source) < credits:
            return False
        self.balances[source] -= credits
        self.balances[target] = self.balance(target) + credits
        self._record(target, "transfer_in", credits)
        return True

    def balance(self, team):
        return self.balances.get(team, 0)

    def history(self, team):
        return list(self.entries.get(team, []))
