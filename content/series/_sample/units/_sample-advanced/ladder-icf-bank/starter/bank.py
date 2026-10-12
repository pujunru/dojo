class Bank:
    """An in-memory bank. Level 1: accounts, deposits and transfers."""

    def __init__(self):
        pass

    def create_account(self, account_id: str) -> bool:
        raise NotImplementedError

    def deposit(self, account_id: str, amount: int) -> int | None:
        raise NotImplementedError

    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:
        raise NotImplementedError
