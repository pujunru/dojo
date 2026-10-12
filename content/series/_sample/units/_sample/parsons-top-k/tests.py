from dojo import kc
from solution import top_k


@kc("_sample-sort-key")
def test_highest_first_ties_by_name():
    assert top_k({"bo": 3, "al": 3, "cy": 5, "di": 1}, 3) == ["cy", "al", "bo"]


@kc("_sample-sort-key")
def test_k_larger_than_input():
    assert top_k({"x": 1}, 5) == ["x"]
