class CreditLedger:
    """GPU credits per team, with transfers and a per-team history."""

    def __init__(self):
        self.balances: dict[str, int] = {}
        self.entries: dict[str, list[tuple[str, int]]] = {}

    def _apply(self, team: str, kind: str, delta: int) -> None:
        self.balances[team] = self.balances.get(team, 0) + delta
        self.entries.setdefault(team, []).append((kind, delta))

    @staticmethod
    def _check(credits: int) -> None:
        if credits <= 0:
            raise ValueError("credits must be positive")

    def grant(self, team: str, credits: int) -> int:
        self._check(credits)
        self._apply(team, "grant", credits)
        return self.balances[team]

    def spend(self, team: str, credits: int) -> bool:
        self._check(credits)
        if self.balance(team) < credits:
            return False
        self._apply(team, "spend", -credits)
        return True

    def transfer(self, source: str, target: str, credits: int) -> bool:
        self._check(credits)
        if source == target:
            raise ValueError("source and target must differ")
        if self.balance(source) < credits:
            return False
        self._apply(source, "transfer_out", -credits)
        self._apply(target, "transfer_in", credits)
        return True

    def balance(self, team: str) -> int:
        return self.balances.get(team, 0)

    def history(self, team: str) -> list[tuple[str, int]]:
        return list(self.entries.get(team, []))
