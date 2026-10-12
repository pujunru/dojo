def top_k(scores, k):
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    names = []
    for name, _ in ranked[:k]:
        names.append(name)
    return names
