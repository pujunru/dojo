def add_item(name, bag=None):
    bag = [] if bag is None else bag
    bag.append(name)
    return bag


def pack(order):
    """Return a fresh bag holding every item of the order."""
    bag = None
    for name in order:
        bag = add_item(name) if bag is None else add_item(name, bag)
    return bag or []
