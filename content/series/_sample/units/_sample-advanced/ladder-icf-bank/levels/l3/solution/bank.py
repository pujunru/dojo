import time


class Bank:
    """An in-memory bank. Level 3: adds scheduled payments on the clock."""

    def __init__(self):
        self.balances: dict[str, int] = {}
        self.outgoing: dict[str, int] = {}
        self.pending: dict[str, tuple[float, int, str, int]] = {}
        self.created = 0

    def _settle(self) -> None:
        now = time.time()
        due = sorted((p for p in self.pending.items() if p[1][0] <= now), key=lambda p: (p[1][0], p[1][1]))
        for payment_id, (_, _, account_id, amount) in due:
            del self.pending[payment_id]
            if self.balances[account_id] >= amount:
                self.balances[account_id] -= amount
                self.outgoing[account_id] += amount

    def create_account(self, account_id: str) -> bool:
        self._settle()
        if account_id in self.balances:
            return False
        self.balances[account_id] = 0
        self.outgoing[account_id] = 0
        return True

    def deposit(self, account_id: str, amount: int) -> int | None:
        self._settle()
        if account_id not in self.balances:
            return None
        self.balances[account_id] += amount
        return self.balances[account_id]

    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:
        self._settle()
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
        self._settle()
        ranked = sorted(self.outgoing.items(), key=lambda item: (-item[1], item[0]))
        return [f"{account_id}({total})" for account_id, total in ranked[:n]]

    def schedule_payment(self, account_id: str, amount: int, delay: float) -> str | None:
        self._settle()
        if account_id not in self.balances:
            return None
        self.created += 1
        payment_id = f"payment{self.created}"
        self.pending[payment_id] = (time.time() + delay, self.created, account_id, amount)
        return payment_id

    def cancel_payment(self, account_id: str, payment_id: str) -> bool:
        self._settle()
        payment = self.pending.get(payment_id)
        if payment is None or payment[2] != account_id:
            return False
        del self.pending[payment_id]
        return True
