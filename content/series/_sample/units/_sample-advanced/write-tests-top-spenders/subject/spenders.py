def top_spenders(transfers: list[tuple[str, str, int]], accounts: list[str], n: int) -> list[str]:
    """`transfers` are (source, target, amount). Returns the first n accounts as
    "id(total outgoing)", by total descending, ties by id ascending; accounts
    with no outgoing transfer count as 0."""
    totals = {account: 0 for account in accounts}
    for source, _target, amount in transfers:
        totals[source] = totals.get(source, 0) + amount
    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    return [f"{account}({total})" for account, total in ranked[:n]]
