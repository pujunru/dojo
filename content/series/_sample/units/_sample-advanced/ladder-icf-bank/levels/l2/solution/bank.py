class Bank:
    """An in-memory bank. Level 2: adds top spenders."""

    def __init__(self):
        self.balances: dict[str, int] = {}
        self.outgoing: dict[str, int] = {}

    def create_account(self, account_id: str) -> bool:
        if account_id in self.balances:
            return False
        self.balances[account_id] = 0
        self.outgoing[account_id] = 0
        return True

    def deposit(self, account_id: str, amount: int) -> int | None:
        if account_id not in self.balances:
            return None
        self.balances[account_id] += amount
        return self.balances[account_id]

    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:
        if source_id == target_id:
            return None
        if source_id not in self.balances or target_id not in self.balances:
            return None
        if self.balances[source_id] < amount:
            return None
        self.balances[source_id] -= amount
        self.balances[target_id] += amount
        self.outgoing[source_id] += amount
        return self.balances[source_id]

    def top_spenders(self, n: int) -> list[str]:
        ranked = sorted(self.outgoing.items(), key=lambda item: (-item[1], item[0]))
        return [f"{account_id}({total})" for account_id, total in ranked[:n]]
