/**
 * Story fixtures for the advanced Dojo item types (WP9), generated
 * from the validated fixture unit `content/series/_sample/units/_sample-advanced`
 * (`npm run content:build -- --include-fixtures`). Story-only: never imported by product code.
 */
import type { LadderItem, RefactorItem, ReviewItem, WriteTestsItem } from "../core/content-schema";

export const refactorItem: RefactorItem = {
  "id": "dj-sample-adv-refactor-credit-ledger",
  "version": 1,
  "unit": "_sample-advanced",
  "lesson": "_adv-l1",
  "kcs": [
    {
      "id": "_adv-bank-ledger",
      "weight": 1
    },
    {
      "id": "_adv-extension-axis",
      "weight": 0.5
    }
  ],
  "archetype": "scheduling-ledger",
  "skin": "gpu-ledger",
  "difficulty": 3,
  "estSeconds": 600,
  "runtime": "sandbox:python",
  "prompt": {
    "zh-CN": "`CreditLedger` 已经在线上用了，现有测试全绿。现在要在不破坏现有接口的前提下吸收一个新需求。",
    "en-US": "`CreditLedger` is already in production and its existing tests are green. Absorb a new requirement without breaking the existing interface."
  },
  "explanation": {
    "zh-CN": "把所有余额变动收敛到一个 `_apply(team, kind, delta)`：它同时改余额、记历史，新需求就是在这条轴上扩展，而不是在三个方法里各写一份记账。失败路径必须在调用 `_apply` 之前返回。",
    "en-US": "Route every balance change through one `_apply(team, kind, delta)` that updates the balance and the history together; the new requirement then extends along that axis instead of duplicating bookkeeping in three methods. Failure paths must return before `_apply` is called."
  },
  "hints": [
    {
      "zh-CN": "现有三个方法里，哪几行在改余额？把它们收成一处。",
      "en-US": "Which lines in the three methods change a balance? Gather them into one place."
    },
    {
      "zh-CN": "先检查，再变动：失败的转账不应留下任何历史。",
      "en-US": "Check first, then change: a failed transfer must leave no history."
    }
  ],
  "type": "refactor",
  "starter": [
    {
      "path": "ledger.py",
      "content": "class CreditLedger:\n    \"\"\"GPU credits per team.\"\"\"\n\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n\n    def grant(self, team: str, credits: int) -> int:\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        self.balances[team] = self.balances.get(team, 0) + credits\n        return self.balances[team]\n\n    def spend(self, team: str, credits: int) -> bool:\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        current = self.balances.get(team, 0)\n        if current < credits:\n            return False\n        self.balances[team] = current - credits\n        return True\n\n    def balance(self, team: str) -> int:\n        return self.balances.get(team, 0)\n"
    }
  ],
  "solution": [
    {
      "path": "ledger.py",
      "content": "class CreditLedger:\n    \"\"\"GPU credits per team, with transfers and a per-team history.\"\"\"\n\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n        self.entries: dict[str, list[tuple[str, int]]] = {}\n\n    def _apply(self, team: str, kind: str, delta: int) -> None:\n        self.balances[team] = self.balances.get(team, 0) + delta\n        self.entries.setdefault(team, []).append((kind, delta))\n\n    @staticmethod\n    def _check(credits: int) -> None:\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n\n    def grant(self, team: str, credits: int) -> int:\n        self._check(credits)\n        self._apply(team, \"grant\", credits)\n        return self.balances[team]\n\n    def spend(self, team: str, credits: int) -> bool:\n        self._check(credits)\n        if self.balance(team) < credits:\n            return False\n        self._apply(team, \"spend\", -credits)\n        return True\n\n    def transfer(self, source: str, target: str, credits: int) -> bool:\n        self._check(credits)\n        if source == target:\n            raise ValueError(\"source and target must differ\")\n        if self.balance(source) < credits:\n            return False\n        self._apply(source, \"transfer_out\", -credits)\n        self._apply(target, \"transfer_in\", credits)\n        return True\n\n    def balance(self, team: str) -> int:\n        return self.balances.get(team, 0)\n\n    def history(self, team: str) -> list[tuple[str, int]]:\n        return list(self.entries.get(team, []))\n"
    }
  ],
  "tests": {
    "path": "tests.py",
    "content": "from dojo import kc, raises\nfrom ledger import CreditLedger\n\n\n@kc(\"_adv-bank-ledger\", \"_adv-extension-axis\")\ndef test_transfer_moves_credits_between_teams():\n    ledger = CreditLedger()\n    ledger.grant(\"infra\", 50)\n    assert ledger.transfer(\"infra\", \"research\", 20) is True\n    assert ledger.balance(\"infra\") == 30\n    assert ledger.balance(\"research\") == 20\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_short_transfer_changes_nothing():\n    ledger = CreditLedger()\n    ledger.grant(\"infra\", 5)\n    assert ledger.transfer(\"infra\", \"research\", 6) is False\n    assert ledger.balance(\"infra\") == 5\n    assert ledger.history(\"research\") == []\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_transfer_to_self_is_an_error():\n    ledger = CreditLedger()\n    ledger.grant(\"infra\", 5)\n    with raises(ValueError):\n        ledger.transfer(\"infra\", \"infra\", 1)\n\n\n@kc(\"_adv-extension-axis\")\ndef test_history_lists_every_change_in_order():\n    ledger = CreditLedger()\n    ledger.grant(\"infra\", 50)\n    ledger.spend(\"infra\", 5)\n    ledger.transfer(\"infra\", \"research\", 20)\n    assert ledger.history(\"infra\") == [(\"grant\", 50), (\"spend\", -5), (\"transfer_out\", -20)]\n    assert ledger.history(\"research\") == [(\"transfer_in\", 20)]\n\n\n@kc(\"_adv-extension-axis\", \"_adv-bank-ledger\")\ndef test_failed_operations_leave_no_history():\n    ledger = CreditLedger()\n    ledger.grant(\"infra\", 3)\n    ledger.spend(\"infra\", 4)\n    ledger.transfer(\"infra\", \"research\", 4)\n    assert ledger.history(\"infra\") == [(\"grant\", 3)]\n\n\n@kc(\"_adv-extension-axis\")\ndef test_history_of_unknown_team_is_empty():\n    assert CreditLedger().history(\"nobody\") == []\n"
  },
  "testMeta": [
    {
      "id": "test_transfer_moves_credits_between_teams",
      "kcs": [
        "_adv-bank-ledger",
        "_adv-extension-axis"
      ],
      "hidden": true
    },
    {
      "id": "test_short_transfer_changes_nothing",
      "kcs": [
        "_adv-bank-ledger"
      ],
      "hidden": true
    },
    {
      "id": "test_transfer_to_self_is_an_error",
      "kcs": [
        "_adv-bank-ledger"
      ],
      "hidden": true
    },
    {
      "id": "test_history_lists_every_change_in_order",
      "kcs": [
        "_adv-extension-axis"
      ],
      "hidden": true
    },
    {
      "id": "test_failed_operations_leave_no_history",
      "kcs": [
        "_adv-extension-axis",
        "_adv-bank-ledger"
      ],
      "hidden": true
    },
    {
      "id": "test_history_of_unknown_team_is_empty",
      "kcs": [
        "_adv-extension-axis"
      ],
      "hidden": true
    },
    {
      "id": "test_grant_returns_the_new_balance",
      "kcs": [
        "_adv-bank-ledger"
      ],
      "hidden": false
    },
    {
      "id": "test_spend_refuses_more_than_the_balance",
      "kcs": [
        "_adv-bank-ledger"
      ],
      "hidden": false
    },
    {
      "id": "test_non_positive_credits_are_rejected",
      "kcs": [
        "_adv-bank-ledger"
      ],
      "hidden": false
    },
    {
      "id": "test_unknown_team_has_zero_balance",
      "kcs": [
        "_adv-bank-ledger"
      ],
      "hidden": false
    }
  ],
  "mustKill": [
    {
      "id": "history-on-failure",
      "files": [
        {
          "path": "ledger.py",
          "content": "class CreditLedger:\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n        self.entries: dict[str, list[tuple[str, int]]] = {}\n\n    def _record(self, team, kind, delta):\n        self.entries.setdefault(team, []).append((kind, delta))\n\n    def grant(self, team, credits):\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        self.balances[team] = self.balances.get(team, 0) + credits\n        self._record(team, \"grant\", credits)\n        return self.balances[team]\n\n    def spend(self, team, credits):\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        self._record(team, \"spend\", -credits)\n        if self.balance(team) < credits:\n            return False\n        self.balances[team] -= credits\n        return True\n\n    def transfer(self, source, target, credits):\n        if credits <= 0 or source == target:\n            raise ValueError(\"bad transfer\")\n        self._record(source, \"transfer_out\", -credits)\n        if self.balance(source) < credits:\n            return False\n        self.balances[source] -= credits\n        self.balances[target] = self.balance(target) + credits\n        self._record(target, \"transfer_in\", credits)\n        return True\n\n    def balance(self, team):\n        return self.balances.get(team, 0)\n\n    def history(self, team):\n        return list(self.entries.get(team, []))\n"
        }
      ],
      "description": {
        "zh-CN": "先记历史再检查余额，失败的操作也留下记录",
        "en-US": "Records history before checking funds, so failed operations leave entries"
      }
    },
    {
      "id": "one-sided-history",
      "files": [
        {
          "path": "ledger.py",
          "content": "class CreditLedger:\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n        self.entries: dict[str, list[tuple[str, int]]] = {}\n\n    def grant(self, team, credits):\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        self.balances[team] = self.balances.get(team, 0) + credits\n        self.entries.setdefault(team, []).append((\"grant\", credits))\n        return self.balances[team]\n\n    def spend(self, team, credits):\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        if self.balance(team) < credits:\n            return False\n        self.balances[team] -= credits\n        self.entries.setdefault(team, []).append((\"spend\", -credits))\n        return True\n\n    def transfer(self, source, target, credits):\n        if credits <= 0 or source == target:\n            raise ValueError(\"bad transfer\")\n        if self.balance(source) < credits:\n            return False\n        self.balances[source] -= credits\n        self.balances[target] = self.balance(target) + credits\n        self.entries.setdefault(source, []).append((\"transfer_out\", -credits))\n        return True\n\n    def balance(self, team):\n        return self.balances.get(team, 0)\n\n    def history(self, team):\n        return list(self.entries.get(team, []))\n"
        }
      ],
      "description": {
        "zh-CN": "转账只给转出方记账，转入方没有历史",
        "en-US": "A transfer records only the source side; the target gets no history"
      }
    }
  ],
  "options": {
    "seed": 0,
    "fakeClock": false,
    "stepBudget": 200000,
    "wallMs": 4000,
    "asyncTests": false
  },
  "visibleTests": {
    "path": "visible_tests.py",
    "content": "from dojo import kc, raises\nfrom ledger import CreditLedger\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_grant_returns_the_new_balance():\n    ledger = CreditLedger()\n    assert ledger.grant(\"infra\", 40) == 40\n    assert ledger.grant(\"infra\", 2) == 42\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_spend_refuses_more_than_the_balance():\n    ledger = CreditLedger()\n    ledger.grant(\"infra\", 10)\n    assert ledger.spend(\"infra\", 11) is False\n    assert ledger.spend(\"infra\", 10) is True\n    assert ledger.balance(\"infra\") == 0\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_non_positive_credits_are_rejected():\n    ledger = CreditLedger()\n    with raises(ValueError):\n        ledger.grant(\"infra\", 0)\n    with raises(ValueError):\n        ledger.spend(\"infra\", -1)\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_unknown_team_has_zero_balance():\n    assert CreditLedger().balance(\"nobody\") == 0\n"
  },
  "baseline": [
    {
      "path": "ledger.py",
      "content": "class CreditLedger:\n    \"\"\"GPU credits per team.\"\"\"\n\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n\n    def grant(self, team: str, credits: int) -> int:\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        self.balances[team] = self.balances.get(team, 0) + credits\n        return self.balances[team]\n\n    def spend(self, team: str, credits: int) -> bool:\n        if credits <= 0:\n            raise ValueError(\"credits must be positive\")\n        current = self.balances.get(team, 0)\n        if current < credits:\n            return False\n        self.balances[team] = current - credits\n        return True\n\n    def balance(self, team: str) -> int:\n        return self.balances.get(team, 0)\n"
    }
  ],
  "newRequirement": {
    "zh-CN": "- `transfer(source, target, credits) -> bool`：全有或全无；余额不足返回 `False` 且不改任何状态；`credits <= 0` 或 `source == target` 抛 `ValueError`。\n- `history(team) -> list[tuple[str, int]]`：按发生顺序列出该团队的每次变动 `(kind, delta)`，`kind` 为 `grant` / `spend` / `transfer_out` / `transfer_in`，支出为负数。失败的操作不记录。",
    "en-US": "- `transfer(source, target, credits) -> bool`: all or nothing; returns `False` and changes nothing when funds are short; raises `ValueError` for `credits <= 0` or `source == target`.\n- `history(team) -> list[tuple[str, int]]`: every change to the team, in order, as `(kind, delta)` with `kind` one of `grant` / `spend` / `transfer_out` / `transfer_in` and negative deltas for money out. Failed operations are not recorded."
  },
  "constraints": {
    "publicApi": [
      "grant(team, credits) -> int",
      "spend(team, credits) -> bool",
      "balance(team) -> int"
    ],
    "maxChangedLinesHint": 30
  }
};

export const writeTestsItem: WriteTestsItem = {
  "id": "dj-sample-adv-write-tests-top-spenders",
  "version": 1,
  "unit": "_sample-advanced",
  "lesson": "_adv-l1",
  "kcs": [
    {
      "id": "_adv-top-k-ties",
      "weight": 1
    },
    {
      "id": "_adv-mutation-thinking",
      "weight": 0.5
    }
  ],
  "archetype": "scheduling-ledger",
  "skin": "bank",
  "difficulty": 2,
  "estSeconds": 420,
  "runtime": "sandbox:python",
  "prompt": {
    "zh-CN": "为 `top_spenders` 写测试。你的测试必须先在参考实现上全绿，然后尽量杀死预埋的错误实现。",
    "en-US": "Write tests for `top_spenders`. They must pass on the reference implementation first, then kill as many planted wrong implementations as they can."
  },
  "explanation": {
    "zh-CN": "四个变异体各对应一句规格：并列方向、恰好 `n` 个、同一账户多笔求和、零支出账户也要出现。每句规格至少要有一条测试把它钉死。",
    "en-US": "Each of the four mutants breaks one clause of the spec: tie direction, exactly `n` results, summing repeated transfers, and zero-spend accounts still ranking. Every clause needs at least one test that pins it."
  },
  "hints": [
    {
      "zh-CN": "规格里有几个“并且”？每个都写一条测试。",
      "en-US": "How many clauses does the spec have? Write one test per clause."
    },
    {
      "zh-CN": "让两个账户支出相同，看谁排前面。",
      "en-US": "Give two accounts the same total and check who comes first."
    }
  ],
  "type": "write-tests",
  "subject": [
    {
      "path": "spenders.py",
      "content": "def top_spenders(transfers: list[tuple[str, str, int]], accounts: list[str], n: int) -> list[str]:\n    \"\"\"`transfers` are (source, target, amount). Returns the first n accounts as\n    \"id(total outgoing)\", by total descending, ties by id ascending; accounts\n    with no outgoing transfer count as 0.\"\"\"\n    totals = {account: 0 for account in accounts}\n    for source, _target, amount in transfers:\n        totals[source] = totals.get(source, 0) + amount\n    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))\n    return [f\"{account}({total})\" for account, total in ranked[:n]]\n"
    }
  ],
  "spec": {
    "zh-CN": "`top_spenders(transfers, accounts, n)`：`transfers` 是 `(source, target, amount)`。返回前 `n` 个账户，格式 `\"id(累计转出)\"`；按累计转出降序，并列按 id 升序；没转出过的账户算 0，也参与排行。",
    "en-US": "`top_spenders(transfers, accounts, n)`: `transfers` are `(source, target, amount)`. Returns the first `n` accounts as `\"id(total outgoing)\"`, by total descending, ties by id ascending; accounts with no outgoing transfer count as 0 and still rank."
  },
  "testStarter": {
    "path": "test_starter.py",
    "content": "from spenders import top_spenders\n\n\ndef test_orders_by_total_outgoing():\n    transfers = [(\"alice\", \"bob\", 10), (\"carol\", \"bob\", 40)]\n    assert top_spenders(transfers, [\"alice\", \"bob\", \"carol\"], 2) == [\"carol(40)\", \"alice(10)\"]\n\n\n# Add tests below: each wrong implementation must fail at least one of them.\n"
  },
  "mutants": [
    {
      "id": "tie-desc",
      "files": [
        {
          "path": "spenders.py",
          "content": "def top_spenders(transfers, accounts, n):\n    totals = {account: 0 for account in accounts}\n    for source, _target, amount in transfers:\n        totals[source] = totals.get(source, 0) + amount\n    ranked = sorted(totals.items(), key=lambda item: (item[1], item[0]), reverse=True)\n    return [f\"{account}({total})\" for account, total in ranked[:n]]\n"
        }
      ],
      "kcs": [
        "_adv-top-k-ties"
      ],
      "description": {
        "zh-CN": "并列时按 id 降序",
        "en-US": "Breaks ties by id descending"
      }
    },
    {
      "id": "off-by-one",
      "files": [
        {
          "path": "spenders.py",
          "content": "def top_spenders(transfers, accounts, n):\n    totals = {account: 0 for account in accounts}\n    for source, _target, amount in transfers:\n        totals[source] = totals.get(source, 0) + amount\n    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))\n    return [f\"{account}({total})\" for account, total in ranked[: max(0, n - 1)]]\n"
        }
      ],
      "kcs": [
        "_adv-mutation-thinking"
      ],
      "description": {
        "zh-CN": "只返回 `n - 1` 个",
        "en-US": "Returns only `n - 1` accounts"
      }
    },
    {
      "id": "last-amount",
      "files": [
        {
          "path": "spenders.py",
          "content": "def top_spenders(transfers, accounts, n):\n    totals = {account: 0 for account in accounts}\n    for source, _target, amount in transfers:\n        totals[source] = amount\n    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))\n    return [f\"{account}({total})\" for account, total in ranked[:n]]\n"
        }
      ],
      "kcs": [
        "_adv-top-k-ties"
      ],
      "description": {
        "zh-CN": "用最后一笔金额覆盖而不是累加",
        "en-US": "Keeps the last amount instead of summing"
      }
    },
    {
      "id": "drops-zero",
      "files": [
        {
          "path": "spenders.py",
          "content": "def top_spenders(transfers, accounts, n):\n    totals = {}\n    for source, _target, amount in transfers:\n        totals[source] = totals.get(source, 0) + amount\n    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))\n    return [f\"{account}({total})\" for account, total in ranked[:n]]\n"
        }
      ],
      "kcs": [
        "_adv-mutation-thinking"
      ],
      "description": {
        "zh-CN": "没转出过的账户不出现",
        "en-US": "Leaves out accounts that never sent money"
      }
    }
  ],
  "killTarget": 0.75,
  "options": {
    "seed": 0,
    "fakeClock": false,
    "stepBudget": 200000,
    "wallMs": 4000,
    "asyncTests": false
  }
};

export const reviewItem: ReviewItem = {
  "id": "dj-sample-adv-review-payment-scheduler",
  "version": 1,
  "unit": "_sample-advanced",
  "lesson": "_adv-l1",
  "kcs": [
    {
      "id": "_adv-scheduled-events",
      "weight": 1
    },
    {
      "id": "_adv-review-hygiene",
      "weight": 0.5
    }
  ],
  "archetype": "scheduling-ledger",
  "skin": "payments",
  "difficulty": 2,
  "estSeconds": 360,
  "runtime": "none",
  "prompt": {
    "zh-CN": "同事提交了 `run_due()`：执行所有已到期的定时付款。逐行审查，标出有问题的行，并给每条意见选严重程度和类别。",
    "en-US": "A teammate added `run_due()`: run every scheduled payment that has fallen due. Review it line by line, mark the lines with problems, and give each finding a severity and a category."
  },
  "explanation": {
    "zh-CN": "三处问题：`due_at >= now` 让恰好到期的付款被跳过（应为 `>`）；在 `for` 循环里 `remove` 当前列表会跳过下一个元素；`except Exception: pass` 吞掉了失败，付款既不在队列里也没执行。",
    "en-US": "Three problems: `due_at >= now` skips a payment due exactly now (it should be `>`); calling `remove` on the list being iterated skips the next element; `except Exception: pass` swallows the failure, so the payment is neither pending nor executed."
  },
  "hints": [
    {
      "zh-CN": "一笔付款恰好在 `now` 到期，会执行吗？",
      "en-US": "Does a payment due exactly at `now` run?"
    },
    {
      "zh-CN": "边遍历边删除列表元素时会发生什么？",
      "en-US": "What happens when you remove from a list while iterating over it?"
    }
  ],
  "type": "review",
  "diff": "diff --git a/payments.py b/payments.py\n--- a/payments.py\n+++ b/payments.py\n@@ -8,3 +8,15 @@ class PaymentScheduler:\n \n     def schedule(self, account_id, amount, delay):\n         self.pending.append((time.time() + delay, account_id, amount))\n+\n+    def run_due(self):\n+        now = time.time()\n+        for item in self.pending:\n+            due_at, account_id, amount = item\n+            if due_at >= now:\n+                continue\n+            self.pending.remove(item)\n+            try:\n+                self.ledger.spend(account_id, amount)\n+            except Exception:\n+                pass\n",
  "context": [
    {
      "path": "payments.py",
      "content": "import time\n\n\nclass PaymentScheduler:\n    def __init__(self, ledger):\n        self.ledger = ledger\n        self.pending = []\n\n    def schedule(self, account_id, amount, delay):\n        self.pending.append((time.time() + delay, account_id, amount))\n\n    def run_due(self):\n        now = time.time()\n        for item in self.pending:\n            due_at, account_id, amount = item\n            if due_at >= now:\n                continue\n            self.pending.remove(item)\n            try:\n                self.ledger.spend(account_id, amount)\n            except Exception:\n                pass\n"
    }
  ],
  "issues": [
    {
      "id": "due-boundary",
      "path": "payments.py",
      "line": 16,
      "kcs": [
        "_adv-scheduled-events"
      ],
      "severity": "major",
      "category": "correctness",
      "description": {
        "zh-CN": "`>=` 让恰好到期的付款被跳过，应改为 `>`。",
        "en-US": "`>=` skips a payment that is due exactly now; it should be `>`."
      }
    },
    {
      "id": "mutate-while-iterating",
      "path": "payments.py",
      "line": 18,
      "kcs": [
        "_adv-review-hygiene",
        "_adv-scheduled-events"
      ],
      "severity": "blocker",
      "category": "state",
      "description": {
        "zh-CN": "在遍历中 `remove` 会跳过下一笔付款；先收集到期项或重建列表。",
        "en-US": "Removing during iteration skips the next payment; collect the due items first or rebuild the list."
      }
    },
    {
      "id": "swallowed-error",
      "path": "payments.py",
      "line": 21,
      "kcs": [
        "_adv-review-hygiene"
      ],
      "severity": "major",
      "category": "error-handling",
      "description": {
        "zh-CN": "吞掉异常后付款就消失了：既没执行也不在队列里。",
        "en-US": "Swallowing the error loses the payment: it is neither executed nor still pending."
      }
    }
  ],
  "tolerance": 1
};

export const ladderItem: LadderItem = {
  "id": "dj-sample-adv-ladder-icf-bank",
  "version": 1,
  "unit": "_sample-advanced",
  "lesson": "_adv-l1",
  "kcs": [
    {
      "id": "_adv-bank-ledger",
      "weight": 1
    },
    {
      "id": "_adv-top-k-ties",
      "weight": 0.5
    },
    {
      "id": "_adv-scheduled-events",
      "weight": 0.5
    }
  ],
  "archetype": "scheduling-ledger",
  "skin": "bank",
  "difficulty": 3,
  "estSeconds": 2100,
  "runtime": "sandbox:python",
  "prompt": {
    "zh-CN": "ICF 风格的三级小题：一个内存银行，每级在上一级的代码上继续写。每级有自己的计时；超时可以继续，但会被记录。下一级的题面在本级通过或跳过后才出现。",
    "en-US": "An ICF-style three-level mini question: an in-memory bank, each level built on your code from the one before. Every level has its own timer; you may run over, but overtime is recorded. The next level's prompt appears only after this one passes or is skipped."
  },
  "explanation": {
    "zh-CN": "L1 的关键是失败的转账不改任何状态；L2 的排序键是 `(-outgoing, account_id)`，零支出账户也要出现；L3 在每个公开操作开头先结算到期付款，按 `(due, 创建序)` 处理，余额不足就跳过——所以在到期时刻取消已经太晚。",
    "en-US": "L1 hinges on a failed transfer changing nothing; L2 sorts by `(-outgoing, account_id)` and still lists zero-spend accounts; L3 settles due payments at the start of every public operation, in `(due, creation order)`, skipping any that cannot be funded — which is why cancelling at the due time is already too late."
  },
  "hints": [
    {
      "zh-CN": "转账先检查完所有失败条件，再改余额。",
      "en-US": "Check every failure condition before touching any balance."
    },
    {
      "zh-CN": "单独记一份每个账户的累计支出，别从余额反推。",
      "en-US": "Keep a running outgoing total per account; don't derive it from balances."
    },
    {
      "zh-CN": "写一个 `_settle()`，每个公开方法第一行调用它。",
      "en-US": "Write a `_settle()` and call it first thing in every public method."
    }
  ],
  "type": "ladder",
  "starter": [
    {
      "path": "bank.py",
      "content": "class Bank:\n    \"\"\"An in-memory bank. Level 1: accounts, deposits and transfers.\"\"\"\n\n    def __init__(self):\n        pass\n\n    def create_account(self, account_id: str) -> bool:\n        raise NotImplementedError\n\n    def deposit(self, account_id: str, amount: int) -> int | None:\n        raise NotImplementedError\n\n    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:\n        raise NotImplementedError\n"
    }
  ],
  "levels": [
    {
      "id": "l1",
      "title": {
        "zh-CN": "账户、存款与转账",
        "en-US": "Accounts, deposits and transfers"
      },
      "prompt": {
        "zh-CN": "在 `bank.py` 里实现 `Bank`：\n\n- `create_account(account_id) -> bool`：已存在返回 `False`。\n- `deposit(account_id, amount) -> int | None`：返回新余额；账户不存在返回 `None`。\n- `transfer(source_id, target_id, amount) -> int | None`：成功返回转出方新余额；同一账户、任一账户不存在或余额不足时返回 `None`，且**不改变任何余额**。",
        "en-US": "Implement `Bank` in `bank.py`:\n\n- `create_account(account_id) -> bool`: `False` if it already exists.\n- `deposit(account_id, amount) -> int | None`: the new balance; `None` for an unknown account.\n- `transfer(source_id, target_id, amount) -> int | None`: the source's new balance on success; `None` when both ids are the same, either account is unknown, or funds are short — and then **no balance changes**."
      },
      "timeboxMin": 10,
      "kcs": [
        "_adv-bank-ledger"
      ],
      "tests": {
        "path": "tests.py",
        "content": "from dojo import kc\nfrom bank import Bank\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_create_account_rejects_duplicates():\n    bank = Bank()\n    assert bank.create_account(\"alice\") is True\n    assert bank.create_account(\"alice\") is False\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_deposit_returns_new_balance():\n    bank = Bank()\n    bank.create_account(\"alice\")\n    assert bank.deposit(\"alice\", 50) == 50\n    assert bank.deposit(\"alice\", 25) == 75\n    assert bank.deposit(\"bob\", 10) is None\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_transfer_moves_money_and_returns_source_balance():\n    bank = Bank()\n    bank.create_account(\"alice\")\n    bank.create_account(\"bob\")\n    bank.deposit(\"alice\", 100)\n    assert bank.transfer(\"alice\", \"bob\", 30) == 70\n    assert bank.deposit(\"bob\", 0) == 30\n\n\n@kc(\"_adv-bank-ledger\")\ndef test_failed_transfer_changes_nothing():\n    bank = Bank()\n    bank.create_account(\"alice\")\n    bank.create_account(\"bob\")\n    bank.deposit(\"alice\", 20)\n    assert bank.transfer(\"alice\", \"bob\", 21) is None\n    assert bank.transfer(\"alice\", \"alice\", 5) is None\n    assert bank.transfer(\"alice\", \"carol\", 5) is None\n    assert bank.deposit(\"alice\", 0) == 20\n    assert bank.deposit(\"bob\", 0) == 0\n"
      },
      "testMeta": [
        {
          "id": "test_create_account_rejects_duplicates",
          "kcs": [
            "_adv-bank-ledger"
          ],
          "hidden": true
        },
        {
          "id": "test_deposit_returns_new_balance",
          "kcs": [
            "_adv-bank-ledger"
          ],
          "hidden": true
        },
        {
          "id": "test_transfer_moves_money_and_returns_source_balance",
          "kcs": [
            "_adv-bank-ledger"
          ],
          "hidden": true
        },
        {
          "id": "test_failed_transfer_changes_nothing",
          "kcs": [
            "_adv-bank-ledger"
          ],
          "hidden": true
        }
      ],
      "solution": [
        {
          "path": "bank.py",
          "content": "class Bank:\n    \"\"\"An in-memory bank. Level 1: accounts, deposits and transfers.\"\"\"\n\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n\n    def create_account(self, account_id: str) -> bool:\n        if account_id in self.balances:\n            return False\n        self.balances[account_id] = 0\n        return True\n\n    def deposit(self, account_id: str, amount: int) -> int | None:\n        if account_id not in self.balances:\n            return None\n        self.balances[account_id] += amount\n        return self.balances[account_id]\n\n    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:\n        if source_id == target_id:\n            return None\n        if source_id not in self.balances or target_id not in self.balances:\n            return None\n        if self.balances[source_id] < amount:\n            return None\n        self.balances[source_id] -= amount\n        self.balances[target_id] += amount\n        return self.balances[source_id]\n"
        }
      ]
    },
    {
      "id": "l2",
      "title": {
        "zh-CN": "支出排行",
        "en-US": "Top spenders"
      },
      "prompt": {
        "zh-CN": "加上 `top_spenders(n) -> list[str]`：返回前 `n` 个账户，格式 `\"<id>(<累计转出>)\"`。按累计转出降序，并列时按账户 id 升序；没转出过的账户算 0，也要参与排行；`n` 大于账户数时返回全部。转入和失败的转账不计。",
        "en-US": "Add `top_spenders(n) -> list[str]`: the first `n` accounts as `\"<id>(<total outgoing>)\"`, by total outgoing descending, ties by account id ascending. Accounts that never sent money count as 0 and still rank; if `n` exceeds the number of accounts, return them all. Incoming money and failed transfers do not count."
      },
      "timeboxMin": 10,
      "kcs": [
        "_adv-top-k-ties",
        "_adv-bank-ledger"
      ],
      "tests": {
        "path": "tests.py",
        "content": "from dojo import kc\nfrom bank import Bank\n\n\ndef _bank():\n    bank = Bank()\n    for account_id in (\"alice\", \"bob\", \"carol\", \"dave\"):\n        bank.create_account(account_id)\n        bank.deposit(account_id, 100)\n    return bank\n\n\n@kc(\"_adv-top-k-ties\")\ndef test_top_spenders_orders_by_outgoing_total():\n    bank = _bank()\n    bank.transfer(\"alice\", \"bob\", 10)\n    bank.transfer(\"carol\", \"bob\", 40)\n    bank.transfer(\"alice\", \"dave\", 20)\n    assert bank.top_spenders(2) == [\"carol(40)\", \"alice(30)\"]\n\n\n@kc(\"_adv-top-k-ties\")\ndef test_top_spenders_breaks_ties_by_account_id():\n    bank = _bank()\n    bank.transfer(\"dave\", \"alice\", 15)\n    bank.transfer(\"bob\", \"alice\", 15)\n    assert bank.top_spenders(3) == [\"bob(15)\", \"dave(15)\", \"alice(0)\"]\n\n\n@kc(\"_adv-top-k-ties\", \"_adv-bank-ledger\")\ndef test_incoming_money_and_failed_transfers_do_not_count():\n    bank = _bank()\n    bank.transfer(\"alice\", \"bob\", 500)\n    bank.transfer(\"bob\", \"carol\", 5)\n    assert bank.top_spenders(1) == [\"bob(5)\"]\n\n\n@kc(\"_adv-top-k-ties\")\ndef test_top_spenders_returns_everyone_when_n_is_large():\n    bank = _bank()\n    assert bank.top_spenders(10) == [\"alice(0)\", \"bob(0)\", \"carol(0)\", \"dave(0)\"]\n"
      },
      "testMeta": [
        {
          "id": "test_top_spenders_orders_by_outgoing_total",
          "kcs": [
            "_adv-top-k-ties"
          ],
          "hidden": true
        },
        {
          "id": "test_top_spenders_breaks_ties_by_account_id",
          "kcs": [
            "_adv-top-k-ties"
          ],
          "hidden": true
        },
        {
          "id": "test_incoming_money_and_failed_transfers_do_not_count",
          "kcs": [
            "_adv-top-k-ties",
            "_adv-bank-ledger"
          ],
          "hidden": true
        },
        {
          "id": "test_top_spenders_returns_everyone_when_n_is_large",
          "kcs": [
            "_adv-top-k-ties"
          ],
          "hidden": true
        }
      ],
      "solution": [
        {
          "path": "bank.py",
          "content": "class Bank:\n    \"\"\"An in-memory bank. Level 2: adds top spenders.\"\"\"\n\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n        self.outgoing: dict[str, int] = {}\n\n    def create_account(self, account_id: str) -> bool:\n        if account_id in self.balances:\n            return False\n        self.balances[account_id] = 0\n        self.outgoing[account_id] = 0\n        return True\n\n    def deposit(self, account_id: str, amount: int) -> int | None:\n        if account_id not in self.balances:\n            return None\n        self.balances[account_id] += amount\n        return self.balances[account_id]\n\n    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:\n        if source_id == target_id:\n            return None\n        if source_id not in self.balances or target_id not in self.balances:\n            return None\n        if self.balances[source_id] < amount:\n            return None\n        self.balances[source_id] -= amount\n        self.balances[target_id] += amount\n        self.outgoing[source_id] += amount\n        return self.balances[source_id]\n\n    def top_spenders(self, n: int) -> list[str]:\n        ranked = sorted(self.outgoing.items(), key=lambda item: (-item[1], item[0]))\n        return [f\"{account_id}({total})\" for account_id, total in ranked[:n]]\n"
        }
      ]
    },
    {
      "id": "l3",
      "title": {
        "zh-CN": "定时付款",
        "en-US": "Scheduled payments"
      },
      "prompt": {
        "zh-CN": "加上定时付款，时间用 `time.time()` 读取（测试会推进假时钟）：\n\n- `schedule_payment(account_id, amount, delay) -> str | None`：返回 `\"payment1\"`、`\"payment2\"`…（全局计数）；账户不存在返回 `None`。付款在 `now + delay` 到期。\n- 每个公开操作**开始前**先执行所有已到期（`due <= now`）的付款：先按到期时间，再按创建顺序；余额不足的付款直接跳过。执行成功的付款计入累计转出。\n- `cancel_payment(account_id, payment_id) -> bool`：仅当付款仍待执行且属于该账户时取消并返回 `True`。",
        "en-US": "Add scheduled payments; read time with `time.time()` (the tests advance a fake clock):\n\n- `schedule_payment(account_id, amount, delay) -> str | None`: returns `\"payment1\"`, `\"payment2\"`, … (one global counter); `None` for an unknown account. The payment falls due at `now + delay`.\n- **Before** every public operation, run every due payment (`due <= now`): by due time, then creation order; a payment the balance cannot cover is skipped. Executed payments count as outgoing.\n- `cancel_payment(account_id, payment_id) -> bool`: cancels and returns `True` only if the payment is still pending and belongs to that account."
      },
      "timeboxMin": 15,
      "kcs": [
        "_adv-scheduled-events",
        "_adv-bank-ledger",
        "_adv-top-k-ties"
      ],
      "tests": {
        "path": "tests.py",
        "content": "from dojo import kc\nfrom bank import Bank\n\n\ndef _bank():\n    bank = Bank()\n    bank.create_account(\"alice\")\n    bank.create_account(\"bob\")\n    bank.deposit(\"alice\", 100)\n    return bank\n\n\n@kc(\"_adv-scheduled-events\")\ndef test_payment_executes_once_its_time_arrives(clock):\n    bank = _bank()\n    assert bank.schedule_payment(\"alice\", 30, 10) == \"payment1\"\n    clock.advance(9)\n    assert bank.deposit(\"alice\", 0) == 100\n    clock.advance(1)\n    assert bank.deposit(\"alice\", 0) == 70\n\n\n@kc(\"_adv-scheduled-events\")\ndef test_payments_due_together_run_in_creation_order(clock):\n    bank = _bank()\n    bank.schedule_payment(\"alice\", 80, 5)\n    bank.schedule_payment(\"alice\", 50, 5)\n    clock.advance(5)\n    assert bank.deposit(\"alice\", 0) == 20\n\n\n@kc(\"_adv-scheduled-events\", \"_adv-bank-ledger\")\ndef test_payment_without_funds_is_skipped(clock):\n    bank = _bank()\n    bank.schedule_payment(\"alice\", 500, 1)\n    clock.advance(2)\n    assert bank.deposit(\"alice\", 0) == 100\n    assert bank.top_spenders(1) == [\"alice(0)\"]\n\n\n@kc(\"_adv-scheduled-events\")\ndef test_cancel_before_due_but_not_at_due_time(clock):\n    bank = _bank()\n    first = bank.schedule_payment(\"alice\", 10, 5)\n    second = bank.schedule_payment(\"alice\", 10, 5)\n    assert bank.cancel_payment(\"bob\", first) is False\n    assert bank.cancel_payment(\"alice\", first) is True\n    clock.advance(5)\n    assert bank.cancel_payment(\"alice\", second) is False\n    assert bank.deposit(\"alice\", 0) == 90\n\n\n@kc(\"_adv-scheduled-events\", \"_adv-top-k-ties\")\ndef test_executed_payments_count_as_outgoing(clock):\n    bank = _bank()\n    bank.schedule_payment(\"alice\", 25, 3)\n    bank.schedule_payment(\"bob\", 1, 1)\n    assert bank.schedule_payment(\"carol\", 1, 1) is None\n    clock.advance(3)\n    assert bank.top_spenders(2) == [\"alice(25)\", \"bob(0)\"]\n"
      },
      "testMeta": [
        {
          "id": "test_payment_executes_once_its_time_arrives",
          "kcs": [
            "_adv-scheduled-events"
          ],
          "hidden": true
        },
        {
          "id": "test_payments_due_together_run_in_creation_order",
          "kcs": [
            "_adv-scheduled-events"
          ],
          "hidden": true
        },
        {
          "id": "test_payment_without_funds_is_skipped",
          "kcs": [
            "_adv-scheduled-events",
            "_adv-bank-ledger"
          ],
          "hidden": true
        },
        {
          "id": "test_cancel_before_due_but_not_at_due_time",
          "kcs": [
            "_adv-scheduled-events"
          ],
          "hidden": true
        },
        {
          "id": "test_executed_payments_count_as_outgoing",
          "kcs": [
            "_adv-scheduled-events",
            "_adv-top-k-ties"
          ],
          "hidden": true
        }
      ],
      "solution": [
        {
          "path": "bank.py",
          "content": "import time\n\n\nclass Bank:\n    \"\"\"An in-memory bank. Level 3: adds scheduled payments on the clock.\"\"\"\n\n    def __init__(self):\n        self.balances: dict[str, int] = {}\n        self.outgoing: dict[str, int] = {}\n        self.pending: dict[str, tuple[float, int, str, int]] = {}\n        self.created = 0\n\n    def _settle(self) -> None:\n        now = time.time()\n        due = sorted((p for p in self.pending.items() if p[1][0] <= now), key=lambda p: (p[1][0], p[1][1]))\n        for payment_id, (_, _, account_id, amount) in due:\n            del self.pending[payment_id]\n            if self.balances[account_id] >= amount:\n                self.balances[account_id] -= amount\n                self.outgoing[account_id] += amount\n\n    def create_account(self, account_id: str) -> bool:\n        self._settle()\n        if account_id in self.balances:\n            return False\n        self.balances[account_id] = 0\n        self.outgoing[account_id] = 0\n        return True\n\n    def deposit(self, account_id: str, amount: int) -> int | None:\n        self._settle()\n        if account_id not in self.balances:\n            return None\n        self.balances[account_id] += amount\n        return self.balances[account_id]\n\n    def transfer(self, source_id: str, target_id: str, amount: int) -> int | None:\n        self._settle()\n        if source_id == target_id:\n            return None\n        if source_id not in self.balances or target_id not in self.balances:\n            return None\n        if self.balances[source_id] < amount:\n            return None\n        self.balances[source_id] -= amount\n        self.balances[target_id] += amount\n        self.outgoing[source_id] += amount\n        return self.balances[source_id]\n\n    def top_spenders(self, n: int) -> list[str]:\n        self._settle()\n        ranked = sorted(self.outgoing.items(), key=lambda item: (-item[1], item[0]))\n        return [f\"{account_id}({total})\" for account_id, total in ranked[:n]]\n\n    def schedule_payment(self, account_id: str, amount: int, delay: float) -> str | None:\n        self._settle()\n        if account_id not in self.balances:\n            return None\n        self.created += 1\n        payment_id = f\"payment{self.created}\"\n        self.pending[payment_id] = (time.time() + delay, self.created, account_id, amount)\n        return payment_id\n\n    def cancel_payment(self, account_id: str, payment_id: str) -> bool:\n        self._settle()\n        payment = self.pending.get(payment_id)\n        if payment is None or payment[2] != account_id:\n            return False\n        del self.pending[payment_id]\n        return True\n"
        }
      ]
    }
  ],
  "options": {
    "seed": 0,
    "fakeClock": true,
    "stepBudget": 200000,
    "wallMs": 4000,
    "asyncTests": false
  },
  "checkpointFor": "_sample-advanced"
};

