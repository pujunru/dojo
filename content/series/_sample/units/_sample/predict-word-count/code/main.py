counts = {}
for word in "b a c a b a".split():
    counts[word] = counts.get(word, 0) + 1

ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
print(ranked)
print(ranked[0][0] * ranked[0][1])
