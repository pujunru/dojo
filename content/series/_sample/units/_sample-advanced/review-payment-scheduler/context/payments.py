import time


class PaymentScheduler:
    def __init__(self, ledger):
        self.ledger = ledger
        self.pending = []

    def schedule(self, account_id, amount, delay):
        self.pending.append((time.time() + delay, account_id, amount))

    def run_due(self):
        now = time.time()
        for item in self.pending:
            due_at, account_id, amount = item
            if due_at >= now:
                continue
            self.pending.remove(item)
            try:
                self.ledger.spend(account_id, amount)
            except Exception:
                pass
