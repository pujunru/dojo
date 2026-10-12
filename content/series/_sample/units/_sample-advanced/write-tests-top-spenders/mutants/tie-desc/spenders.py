def top_spenders(transfers, accounts, n):
    totals = {account: 0 for account in accounts}
    for source, _target, amount in transfers:
        totals[source] = totals.get(source, 0) + amount
    ranked = sorted(totals.items(), key=lambda item: (item[1], item[0]), reverse=True)
    return [f"{account}({total})" for account, total in ranked[:n]]
