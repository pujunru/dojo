def top_spenders(transfers, accounts, n):
    totals = {account: 0 for account in accounts}
    for source, _target, amount in transfers:
        totals[source] = amount
    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    return [f"{account}({total})" for account, total in ranked[:n]]
