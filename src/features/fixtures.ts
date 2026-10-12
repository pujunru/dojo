/**
 * Story fixtures for the Dojo compositions: realistic items in the
 * content-schema shape (interview-flavoured Python, bilingual prose), path and
 * learner-state view models, and RunResults for every sandbox outcome.
 * Content prose is data (`L10n`), so it lives here rather than in a catalog.
 */
import type {
  ChooseDesignItem,
  ExplainItem,
  FillBlankItem,
  ImplementItem,
  L10n,
  ParsonsItem,
  PredictItem,
  SpotBugItem,
} from "../core/content-schema";
import type { RunResult } from "../core/run-protocol";
import { DEFAULT_HARNESS_OPTIONS } from "../core/run-protocol";
import type { FillBlankAnswer, ImplementAnswer, ParsonsAnswer } from "./index";
import type { KcHeatmapRow, ReviewQueueEntry, SessionKcChange, UnitPathView } from "./index";
import type { RubricCriterionView, RubricScoreView } from "./runtime";

const l = (zh: string, en: string): L10n => ({ "zh-CN": zh, "en-US": en });

const base = {
  version: 1,
  unit: "u-py-fluency",
  lesson: "u-py-fluency-l4",
  archetype: "python-core" as const,
  skin: "generic",
  difficulty: 2 as const,
  estSeconds: 60,
  hints: [] as L10n[],
};

/* ───────────────────────── Items ───────────────────────── */

export const predictStdoutItem: PredictItem = {
  ...base,
  id: "dj-predict-mutable-default",
  type: "predict",
  kcs: [{ id: "py-mutable-default", weight: 1 }, { id: "py-aliasing", weight: 0.5 }],
  runtime: "none",
  prompt: l("这段代码会打印什么？逐行写出输出。", "What does this print? Write the output line by line."),
  explanation: l(
    "默认参数在 **函数定义时** 只求值一次，所以两次调用共享同一个列表：`first is second` 为 `True`，长度是 2。修复方式是 `tags=None`，再在函数体里 `tags = [] if tags is None else tags`。",
    "Default arguments are evaluated **once, at definition time**, so both calls share one list: `first is second` is `True` and its length is 2. The fix is `tags=None` plus `tags = [] if tags is None else tags` in the body.",
  ),
  hints: [
    l("默认值 `[]` 是什么时候创建的？", "When is the default `[]` created?"),
    l("`is` 比较的是对象身份，不是内容。", "`is` compares identity, not contents."),
  ],
  files: [{
    path: "tags.py",
    content: `def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags

first = add_tag("hot")
second = add_tag("cold")
print(first is second, len(first))
print(second)
`,
  }],
  entry: "tags.py",
  answer: { mode: "stdout", stdout: "True 2\n['hot', 'cold']" },
};

export const predictChoiceItem: PredictItem = {
  ...base,
  id: "dj-predict-ttl-boundary",
  type: "predict",
  unit: "u-bb-time",
  lesson: "u-bb-time-l1",
  archetype: "stateful-time",
  skin: "session-store",
  kcs: [{ id: "time-half-open", weight: 1 }],
  runtime: "none",
  prompt: l(
    "`TTLStore` 的约定是：在 `t` 时刻以 `ttl=d` 写入的键，在 `t <= now < t + d` 时可见。会打印什么？",
    "`TTLStore` promises that a key written at `t` with `ttl=d` is visible for `t <= now < t + d`. What is printed?",
  ),
  explanation: l(
    "区间是左闭右开的：`109 < 110` 仍可见，`110` 时刚好过期。面试里最常见的失分就是把边界写成 `now > expires`。",
    "The interval is half-open: `109 < 110` is still visible and at `110` the key has just expired. Writing the check as `now > expires` is the classic interview slip.",
  ),
  files: [{
    path: "main.py",
    content: `from kv_store import TTLStore

store = TTLStore()
store.set("session", "alice", now=100, ttl=10)
print(store.get("session", now=109))
print(store.get("session", now=110))
`,
  }],
  entry: "main.py",
  answer: { mode: "choice", options: ["alice\nalice", "alice\nNone", "None\nNone", "alice\nKeyError"], correct: 1 },
};

export const spotBugItem: SpotBugItem = {
  ...base,
  id: "dj-spot-bank-transfer",
  type: "spot-bug",
  unit: "u-arch-ledger",
  lesson: "u-arch-ledger-l2",
  archetype: "scheduling-ledger",
  skin: "bank",
  difficulty: 2,
  estSeconds: 120,
  kcs: [{ id: "ledger-boundary", weight: 1 }, { id: "sort-tiebreak", weight: 0.5 }],
  runtime: "none",
  prompt: l(
    "`TRANSFER` 在余额**恰好等于**金额时应该成功；`top_accounts` 余额相同时按账户名升序。找出所有出错的行。",
    "`TRANSFER` must succeed when the balance **exactly equals** the amount; `top_accounts` breaks ties by account name, ascending. Find every faulty line.",
  ),
  explanation: l(
    "第 11 行用了 `<=`，把余额正好够的转账拒掉了，应为 `<`。第 18 行只按余额排序，相同余额的顺序取决于插入顺序；键应写成 `key=lambda kv: (-kv[1], kv[0])`。",
    "Line 11 uses `<=`, rejecting a transfer the balance exactly covers; it should be `<`. Line 18 sorts by balance only, so ties fall back to insertion order; use `key=lambda kv: (-kv[1], kv[0])`.",
  ),
  hints: [l("用余额 50、转 50 走一遍。", "Walk through a balance of 50 transferring 50."), l("`sorted` 是稳定排序——稳定于什么？", "`sorted` is stable — stable with respect to what?")],
  files: [{
    path: "bank.py",
    content: `class Bank:
    def __init__(self) -> None:
        self.balances: dict[str, int] = {}

    def deposit(self, account: str, amount: int) -> None:
        self.balances[account] = self.balances.get(account, 0) + amount

    def transfer(self, src: str, dst: str, amount: int) -> bool:
        if src not in self.balances or dst not in self.balances:
            return False
        if self.balances[src] <= amount:
            return False
        self.balances[src] -= amount
        self.balances[dst] += amount
        return True

    def top_accounts(self, k: int) -> list[str]:
        ranked = sorted(self.balances.items(), key=lambda kv: kv[1], reverse=True)
        return [name for name, _ in ranked[:k]]
`,
  }],
  bugs: [
    { path: "bank.py", lines: [11], kcs: ["ledger-boundary"] },
    { path: "bank.py", lines: [18], kcs: ["sort-tiebreak"] },
  ],
  tolerance: 0,
};

export const fillBlankItem: FillBlankItem = {
  ...base,
  id: "dj-fill-lru-ordereddict",
  type: "fill-blank",
  unit: "u-bb-queries-cache",
  lesson: "u-bb-queries-cache-l5",
  archetype: "stateful-time",
  skin: "cache",
  estSeconds: 90,
  kcs: [{ id: "cache-lru", weight: 1 }],
  runtime: "none",
  prompt: l(
    "补全基于 `OrderedDict` 的 LRU：`get` 命中时要把键标记为最近使用；`put` 超出容量时淘汰最久未用的键。",
    "Complete the `OrderedDict`-based LRU: a `get` hit marks the key most recently used; a `put` over capacity evicts the least recently used key.",
  ),
  explanation: l(
    "`move_to_end(key)` 把键移到末尾（最新），`popitem(last=False)` 弹出开头（最旧）。两者都是 O(1)。",
    "`move_to_end(key)` moves the key to the end (newest) and `popitem(last=False)` pops from the front (oldest). Both are O(1).",
  ),
  hints: [l("`OrderedDict` 的哪一端是最旧的？", "Which end of an `OrderedDict` is the oldest?")],
  template: [{
    path: "lru.py",
    content: `from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.data: OrderedDict[str, int] = OrderedDict()

    def get(self, key: str) -> int | None:
        if key not in self.data:
            return None
        # __BLANK:touch__
        return self.data[key]

    def put(self, key: str, value: int) -> None:
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.capacity:
            # __BLANK:evict__
`,
  }],
  blanks: [
    { id: "touch", accept: ["self.data.move_to_end(key)"], kcs: ["cache-lru"] },
    { id: "evict", accept: ["self.data.popitem(last=False)", "self.data.popitem(False)"], kcs: ["cache-lru"] },
  ],
};

export const parsonsItem: ParsonsItem = {
  ...base,
  id: "dj-parsons-resumable-next",
  type: "parsons",
  unit: "u-py-resumable",
  lesson: "u-py-resumable-l2",
  archetype: "python-core",
  skin: "iterator",
  estSeconds: 75,
  kcs: [{ id: "iter-resumable-state", weight: 1 }],
  runtime: "none",
  prompt: l(
    "拼出可恢复迭代器的 `__next__`。`pos` 会被保存和恢复，所以要先读出当前元素，再推进位置。",
    "Assemble `__next__` for a resumable iterator. `pos` is saved and restored, so read the current item before advancing.",
  ),
  explanation: l(
    "先检查越界并抛 `StopIteration`，再读值、推进、返回。先推进再读会跳过第一个元素；`>` 会让最后一次越界访问抛 `IndexError`。",
    "Check the bound and raise `StopIteration` first, then read, advance, return. Advancing before reading skips the first item; `>` lets the final call index out of range with `IndexError`.",
  ),
  lines: [
    { id: "l1", code: "def __next__(self):", indent: 0 },
    { id: "l2", code: "if self.pos >= len(self.items):", indent: 1 },
    { id: "l3", code: "raise StopIteration", indent: 2 },
    { id: "l4", code: "item = self.items[self.pos]", indent: 1 },
    { id: "l5", code: "self.pos += 1", indent: 1 },
    { id: "l6", code: "return item", indent: 1 },
  ],
  solutions: [["l1", "l2", "l3", "l4", "l5", "l6"]],
  distractors: [
    { id: "d1", code: "if self.pos > len(self.items):" },
    { id: "d2", code: "return self.items[self.pos + 1]" },
  ],
  requireIndent: true,
  module: "iterator.py",
};

export const chooseDesignItem: ChooseDesignItem = {
  ...base,
  id: "dj-choose-ttl-history",
  type: "choose-design",
  unit: "u-arch-store",
  lesson: "u-arch-store-l5",
  archetype: "stateful-time",
  skin: "kv-store",
  difficulty: 3,
  estSeconds: 180,
  kcs: [{ id: "design-version-history", weight: 1 }],
  runtime: "none",
  prompt: l("L4 来了。哪种数据结构最能吸收这个变化？", "Level 4 just landed. Which data structure absorbs it best?"),
  explanation: l(
    "按键保存单调递增的版本列表，`get_at` 用 `bisect_right(versions, t) - 1` 定位。写入仍是 O(1) 追加，现有的 `get(now)` 就是 `get_at(now)` 的特例，L1–L3 的测试不用动。",
    "Keep a monotonically growing version list per key and locate with `bisect_right(versions, t) - 1`. Writes stay O(1) appends, and the existing `get(now)` becomes `get_at(now)`, so the L1–L3 tests keep passing untouched.",
  ),
  scenario: l(
    "你的 `TTLStore` 已经通过 L1–L3。L4 新需求：`get_at(key, timestamp)` 返回该键在**过去某个时刻**的值，且要按当时的 TTL 判断是否已过期。写入量很大，历史查询较少；时间戳单调递增。",
    "Your `TTLStore` passes L1–L3. The L4 requirement: `get_at(key, timestamp)` returns the key's value **at a past instant**, honouring the TTL in force then. Writes are heavy, history reads are rare, and timestamps only increase.",
  ),
  options: [
    {
      id: "versions",
      text: l("每个键保存按时间排序的版本列表 `[(t, value, expires)]`，`get_at` 用 `bisect` 找到 ≤ timestamp 的最后一个版本", "Per key, a time-ordered version list `[(t, value, expires)]`; `get_at` uses `bisect` to find the last version ≤ timestamp"),
      correct: true,
      why: l("写入 O(1) 追加，历史读 O(log n)，现有 API 原样保留。", "O(1) appends on write, O(log n) history reads, and the existing API stays as is."),
    },
    {
      id: "snapshot",
      text: l("每次 `set` 时深拷贝整个字典，按时间戳存成快照", "Deep-copy the whole dict on every `set` and store it as a snapshot by timestamp"),
      correct: false,
      why: l("每次写都是 O(N) 的拷贝；写多读少的场景正好反过来。", "Every write becomes an O(N) copy — the opposite of what a write-heavy workload needs."),
    },
    {
      id: "replay",
      text: l("只保留最新值，`get_at` 时从操作日志倒推", "Keep only the latest value and replay the operation log backwards in `get_at`"),
      correct: false,
      why: l("历史读要线性回放；而且这份日志本身就是没加索引的版本列表。", "History reads replay linearly, and that log is just a version list without an index."),
    },
    {
      id: "composite-key",
      text: l("把时间戳拼进键：`f\"{key}@{t}\"`，存进同一个 dict", "Encode the timestamp into the key — `f\"{key}@{t}\"` — in the same dict"),
      correct: false,
      why: l("精确匹配找不到任意时刻的值，还得另建排序索引。", "Exact matching can't answer an arbitrary instant; you would still need a sorted index."),
    },
  ],
  multi: false,
  rationale: { criteria: [{ id: "write-cost", kcs: ["design-version-history"], weight: 1, description: l("说明写入代价", "Addresses write cost") }], passAt: 0.7 },
};

const ttlStarter = `class TTLStore:
    """In-memory key-value store with per-key expiry.

    Timestamps are integers supplied by the caller. A key written at t
    with ttl=d is visible for t <= now < t + d.
    """

    def __init__(self) -> None:
        pass

    def set(self, key: str, value: str, now: int, ttl: int | None = None) -> None:
        raise NotImplementedError

    def get(self, key: str, now: int) -> str | None:
        raise NotImplementedError

    def scan(self, prefix: str, now: int) -> list[str]:
        """Live keys that start with prefix, sorted."""
        raise NotImplementedError
`;

export const implementItem: ImplementItem = {
  ...base,
  id: "dj-implement-ttl-store",
  type: "implement",
  unit: "u-arch-store",
  lesson: "u-arch-store-l2",
  archetype: "stateful-time",
  skin: "kv-store",
  difficulty: 3,
  estSeconds: 600,
  kcs: [{ id: "time-half-open", weight: 1 }, { id: "store-prefix-scan", weight: 0.5 }],
  runtime: "sandbox:python",
  prompt: l(
    "实现 `TTLStore`：`set` 写入并可带 TTL，`get` 返回仍然有效的值，`scan(prefix)` 按字典序返回仍有效的键。时间由调用方传入。",
    "Implement `TTLStore`: `set` writes with an optional TTL, `get` returns a still-live value, and `scan(prefix)` returns live keys in lexicographic order. Callers pass the time in.",
  ),
  explanation: l(
    "存 `(value, expires_at)`，读时惰性判断 `now >= expires_at` 即过期。`scan` 复用同一个判断，避免两处边界不一致。",
    "Store `(value, expires_at)` and treat `now >= expires_at` as expired, lazily on read. `scan` reuses the same check so the two boundaries can't drift apart.",
  ),
  hints: [
    l("每个键需要存什么，才能在读的时候判断它是否过期？", "What must you store per key to decide expiry at read time?"),
    l("`now == expires_at` 算过期。", "`now == expires_at` counts as expired."),
  ],
  starter: [{ path: "kv_store.py", content: ttlStarter }],
  solution: [{
    path: "kv_store.py",
    content: `class TTLStore:
    def __init__(self) -> None:
        self._data: dict[str, tuple[str, int | None]] = {}

    def _live(self, key: str, now: int) -> bool:
        entry = self._data.get(key)
        return entry is not None and (entry[1] is None or now < entry[1])

    def set(self, key, value, now, ttl=None):
        self._data[key] = (value, None if ttl is None else now + ttl)

    def get(self, key, now):
        return self._data[key][0] if self._live(key, now) else None

    def scan(self, prefix, now):
        return sorted(k for k in self._data if k.startswith(prefix) and self._live(k, now))
`,
  }],
  tests: { path: "test_kv_store.py", content: "# hidden" },
  visibleTests: {
    path: "test_visible.py",
    content: `from kv_store import TTLStore


def test_set_then_get():
    store = TTLStore()
    store.set("a", "v1", now=0)
    assert store.get("a", now=5) == "v1"


def test_expiry_is_half_open():
    store = TTLStore()
    store.set("a", "v1", now=100, ttl=10)
    assert store.get("a", now=109) == "v1"
    assert store.get("a", now=110) is None
`,
  },
  testMeta: [
    { id: "test_set_then_get", kcs: ["time-half-open"], hidden: false, title: l("写入后能读到", "Reads back what was written") },
    { id: "test_missing_key_returns_none", kcs: ["time-half-open"], hidden: true, title: l("不存在的键返回 None", "A missing key returns None") },
    { id: "test_expiry_is_half_open", kcs: ["time-half-open"], hidden: false, title: l("过期边界是左闭右开", "Expiry boundary is half-open") },
    { id: "test_overwrite_resets_ttl", kcs: ["time-half-open"], hidden: true, title: l("重写会刷新 TTL", "A rewrite refreshes the TTL") },
    { id: "test_scan_prefix_sorted_live_only", kcs: ["store-prefix-scan"], hidden: true, title: l("scan 只返回有效键且有序", "scan returns live keys in order") },
    { id: "test_many_keys_scan_is_fast", kcs: ["store-prefix-scan"], hidden: true, title: l("一万个键的 scan 不超时", "scan over 10k keys stays fast") },
  ],
  mustKill: [],
  options: { ...DEFAULT_HARNESS_OPTIONS, wallMs: 6000 },
};

export const implementAnswerBuggy: ImplementAnswer = {
  files: [{
    path: "kv_store.py",
    content: `class TTLStore:
    def __init__(self) -> None:
        self._data: dict[str, tuple[str, int | None]] = {}

    def set(self, key, value, now, ttl=None):
        expires = None if ttl is None else now + ttl
        self._data[key] = (value, expires)

    def get(self, key, now):
        entry = self._data.get(key)
        if entry is None:
            return None
        value, expires = entry
        if expires is not None and now > expires:
            return None
        return value

    def scan(self, prefix, now):
        return sorted(k for k in self._data if k.startswith(prefix) and self.get(k, now) is not None)
`,
  }],
};

export const implementAnswerFixed: ImplementAnswer = {
  files: [{ path: "kv_store.py", content: implementAnswerBuggy.files[0]!.content.replace("now > expires", "now >= expires") }],
};

export const explainItem: ExplainItem = {
  ...base,
  id: "dj-explain-crawler-termination",
  type: "explain",
  unit: "u-conc-futures",
  lesson: "u-conc-futures-l5",
  archetype: "concurrent-io",
  skin: "crawler",
  difficulty: 3,
  estSeconds: 150,
  kcs: [{ id: "conc-termination", weight: 1 }],
  runtime: "none",
  prompt: l("口头题：面试官让你讲清楚爬虫什么时候算爬完。", "Spoken question: the interviewer asks when the crawler is actually done."),
  explanation: l(
    "空队列只说明“此刻没有排队的 URL”，在途的 worker 仍可能放入新链接。正确判据是在途计数归零：每次 `put` 前加一、处理完在 `finally` 里减一，或用 `q.join()` 配合 `task_done()`。",
    "An empty queue only means nothing is waiting right now; in-flight workers may still enqueue links. The correct signal is an in-flight count reaching zero: increment before each `put`, decrement in `finally` when done — or `q.join()` with `task_done()`.",
  ),
  question: l(
    "多线程爬虫用 `queue.Queue` 分发 URL，主线程在 `q.empty()` 为真时宣布爬完。这为什么会提前结束？应该用什么来判断？",
    "A threaded crawler hands out URLs through `queue.Queue`, and the main thread declares completion when `q.empty()` is true. Why does that stop early, and what should it check instead?",
  ),
  context: [{
    path: "crawler.py",
    content: `def worker(q: Queue, seen: set[str], lock: Lock) -> None:
    while True:
        url = q.get()
        try:
            for link in fetch_links(url):
                with lock:
                    if link in seen:
                        continue
                    seen.add(link)
                q.put(link)
        finally:
            q.task_done()
`,
  }],
  rubric: {
    passAt: 0.7,
    criteria: [
      { id: "race", kcs: ["conc-termination"], weight: 2, description: l("指出空队列不等于完成：在途 worker 还会放入新链接", "Says an empty queue isn't completion: in-flight workers still enqueue links"), mustMention: ["in-flight", "race"] },
      { id: "signal", kcs: ["conc-termination"], weight: 2, description: l("给出正确判据：在途计数归零，或 `join()` 配合 `task_done()`", "Gives the right signal: in-flight count reaches zero, or `join()` with `task_done()`") },
      { id: "finally", kcs: ["conc-termination"], weight: 1, description: l("说明 `task_done()` 必须放在 `finally` 里，否则异常会让 `join()` 永远挂住", "Explains `task_done()` belongs in `finally`, or an exception hangs `join()` forever") },
    ],
  },
  modelAnswer: l(
    "`q.empty()` 只反映这一瞬间。worker 刚 `get()` 走最后一个 URL 时队列是空的，但它马上会解析出新链接放回去——这是一个竞态。应该跟踪**在途任务数**：放入时加一，处理完减一，归零才算完成；标准库里就是 `q.join()` + 每个 `get()` 对应一次 `task_done()`。`task_done()` 要写在 `finally` 里，否则一次抓取异常就让 `join()` 永远等下去。",
    "`q.empty()` reflects a single instant. Right after a worker `get()`s the last URL the queue is empty, yet it is about to enqueue the links it parses — a race. Track **in-flight work** instead: increment on enqueue, decrement when processed, and finish at zero; in the stdlib that is `q.join()` with one `task_done()` per `get()`. Put `task_done()` in `finally`, or a single fetch exception leaves `join()` waiting forever.",
  ),
};

/* ───────────────────────── Answers ───────────────────────── */

/** Types `values` into the blanks of an empty fill-blank answer (later blanks first, so offsets stay valid). */
export function fillBlanks(answer: FillBlankAnswer, values: Record<string, string>): FillBlankAnswer {
  return {
    files: answer.files.map((file) => {
      let code = file.code;
      const ordered = [...file.blanks].sort((a, b) => b.from - a.from);
      const lengths = new Map<string, number>();
      for (const blank of ordered) {
        const text = values[blank.id] ?? "";
        code = code.slice(0, blank.from) + text + code.slice(blank.to);
        lengths.set(blank.id, text.length - (blank.to - blank.from));
      }
      let shift = 0;
      const blanks = [...file.blanks].sort((a, b) => a.from - b.from).map((blank) => {
        const text = values[blank.id] ?? "";
        const from = blank.from + shift;
        shift += lengths.get(blank.id) ?? 0;
        return { id: blank.id, from, to: from + text.length };
      });
      return { ...file, code, blanks };
    }),
  };
}

const parsonsLine = (id: string, indent: number) => {
  const line = [...parsonsItem.lines, ...parsonsItem.distractors].find((entry) => entry.id === id)!;
  return { id, code: line.code, indent };
};

export const parsonsAnswerCorrect: ParsonsAnswer = {
  items: parsonsItem.lines.map((line) => ({ id: line.id, code: line.code, indent: line.indent })),
  pool: parsonsItem.distractors.map((line) => ({ id: line.id, code: line.code, indent: 0 })),
};

export const parsonsAnswerWrong: ParsonsAnswer = {
  items: [parsonsLine("l1", 0), parsonsLine("d1", 1), parsonsLine("l3", 2), parsonsLine("l5", 1), parsonsLine("l4", 1), parsonsLine("l6", 1)],
  pool: [parsonsLine("l2", 0), parsonsLine("d2", 0)],
};

export const parsonsAnswerPartial: ParsonsAnswer = {
  items: [parsonsLine("l1", 0), parsonsLine("l2", 1), parsonsLine("l3", 2)],
  pool: [parsonsLine("l5", 0), parsonsLine("d2", 0), parsonsLine("l4", 0), parsonsLine("l6", 0), parsonsLine("d1", 0)],
};

/* ───────────────────────── Run results ───────────────────────── */

const RT = "cpython-sandbox" as const;

export const runAllGreen: RunResult = {
  status: "ok",
  passed: 6,
  total: 6,
  results: [
    { id: "test_set_then_get", ok: true, ms: 1 },
    { id: "test_missing_key_returns_none", ok: true, ms: 0 },
    { id: "test_expiry_is_half_open", ok: true, ms: 1 },
    { id: "test_overwrite_resets_ttl", ok: true, ms: 1 },
    { id: "test_scan_prefix_sorted_live_only", ok: true, ms: 2 },
    { id: "test_many_keys_scan_is_fast", ok: true, ms: 38 },
  ],
  stdout: "",
  stderr: "",
  runtime: RT,
  ms: 412,
};

const tracebackText = `Traceback (most recent call last):
  File "test_kv_store.py", line 41, in test_scan_prefix_sorted_live_only
    assert store.scan("user:", now=20) == ["user:1", "user:3"]
  File "kv_store.py", line 19, in scan
    return sorted(k for k in self._data if k.startswith(prefix) and self.get(k, now) is not None)
  File "kv_store.py", line 19, in <genexpr>
    return sorted(k for k in self._data if k.startswith(prefix) and self.get(k, now) is not None)
  File "kv_store.py", line 13, in get
    value, expires = entry
TypeError: cannot unpack non-iterable NoneType object`;

/** Assertion, error with traceback and timeout, matching `implementAnswerBuggy`. */
export const runSomeFailing: RunResult = {
  status: "ok",
  passed: 3,
  total: 6,
  results: [
    { id: "test_set_then_get", ok: true, ms: 1 },
    { id: "test_missing_key_returns_none", ok: true, ms: 0 },
    {
      id: "test_expiry_is_half_open",
      ok: false,
      ms: 1,
      kind: "assert",
      msg: "assert 'v1' is None\n +  where 'v1' = <kv_store.TTLStore object>.get('a', now=110)",
      file: "test_visible.py",
      line: 14,
    },
    { id: "test_overwrite_resets_ttl", ok: true, ms: 1 },
    {
      id: "test_scan_prefix_sorted_live_only",
      ok: false,
      ms: 2,
      kind: "error",
      exc: "TypeError",
      msg: "cannot unpack non-iterable NoneType object",
      frames: [["test_kv_store.py", 41, "test_scan_prefix_sorted_live_only"], ["kv_store.py", 19, "scan"], ["kv_store.py", 13, "get"]],
      traceback: tracebackText,
      stdout: "scanning prefix 'user:' at now=20\n",
    },
    { id: "test_many_keys_scan_is_fast", ok: false, ms: 2000, kind: "timeout" },
  ],
  stdout: "",
  stderr: "",
  runtime: RT,
  ms: 2410,
};

/** Consistent with `implementAnswerBuggy`: only the boundary test fails. */
export const runBoundaryOnly: RunResult = {
  ...runAllGreen,
  passed: 5,
  results: runAllGreen.status === "ok"
    ? runAllGreen.results.map((outcome) => outcome.id === "test_expiry_is_half_open"
      ? { id: outcome.id, ok: false as const, ms: 1, kind: "assert" as const, msg: "assert 'v1' is None\n +  where 'v1' = <kv_store.TTLStore object>.get('a', now=110)", file: "test_visible.py", line: 14 }
      : outcome)
    : [],
};

export const runCompileError: RunResult = { status: "compile_error", file: "kv_store.py", line: 9, col: 23, msg: "SyntaxError: expected ':'", runtime: RT };

export const runImportError: RunResult = {
  status: "import_error",
  exc: "ModuleNotFoundError",
  msg: "No module named 'sortedcontainers'",
  frames: [["kv_store.py", 1, "<module>"]],
  traceback: `Traceback (most recent call last):
  File "kv_store.py", line 1, in <module>
    from sortedcontainers import SortedDict
ModuleNotFoundError: No module named 'sortedcontainers'`,
  runtime: RT,
};

export const runJobTimeout: RunResult = { status: "timeout", scope: "job", runtime: RT };
export const runHarnessError: RunResult = { status: "harness_error", msg: "job.json: options.wallMs must be a positive integer", runtime: RT };
export const runUnavailable: RunResult = { status: "runtime_unavailable", reason: "no_runner", runtime: RT };

const longStdout = Array.from({ length: 60 }, (_, index) => `tick ${String(index).padStart(2, "0")}: queue=${(index * 7) % 13} in_flight=${(index * 3) % 5}`).join("\n");

export const runLongOutput: RunResult = {
  status: "ok",
  passed: 1,
  total: 2,
  results: [
    { id: "test_crawler_terminates", ok: true, ms: 84, stdout: longStdout.split("\n").slice(0, 8).join("\n") },
    { id: "test_no_duplicate_fetch", ok: false, ms: 91, kind: "assert", msg: "assert fetched.count('/a') == 1\n +  where 2 = ['/', '/a', '/b', '/a'].count('/a')", file: "test_crawler.py", line: 33, stdout: longStdout },
  ],
  stdout: longStdout,
  stderr: "",
  runtime: RT,
  ms: 640,
};

export const runMutants: RunResult = {
  status: "mutants",
  base: { passed: 4, total: 4 },
  mutants: [
    { id: "boundary-gt", killed: true, by: "test_expiry_is_half_open" },
    { id: "no-refresh", killed: true, by: "test_overwrite_resets_ttl" },
    { id: "scan-unsorted", killed: false },
    { id: "scan-includes-expired", killed: false },
  ],
  runtime: RT,
  ms: 980,
};

export const runMutantsAllKilled: RunResult = {
  ...runMutants,
  mutants: runMutants.status === "mutants" ? runMutants.mutants.map((mutant) => ({ ...mutant, killed: true, by: mutant.by ?? "test_scan_prefix_sorted_live_only" })) : [],
};

export const runTestsFailOnReference: RunResult = {
  status: "tests_fail_on_reference",
  base: {
    status: "ok",
    passed: 1,
    total: 2,
    results: [
      { id: "test_set_then_get", ok: true, ms: 1 },
      { id: "test_scan_is_reverse_sorted", ok: false, ms: 1, kind: "assert", msg: "assert ['user:1', 'user:3'] == ['user:3', 'user:1']", file: "test_mine.py", line: 22 },
    ],
    stdout: "",
    stderr: "",
    runtime: RT,
    ms: 120,
  },
  runtime: RT,
  ms: 140,
};

export const mutantDescriptions = (zh: boolean): Record<string, string> => ({
  "boundary-gt": zh ? "边界用 `>`，键多活一个瞬间" : "Uses `>` at the boundary, so keys live one instant too long",
  "no-refresh": zh ? "重写不刷新 TTL" : "A rewrite doesn't refresh the TTL",
  "scan-unsorted": zh ? "scan 返回插入顺序而不是字典序" : "scan returns insertion order, not lexicographic order",
  "scan-includes-expired": zh ? "scan 里包含了已过期的键" : "scan includes expired keys",
});

/* ───────────────────────── Rubric ───────────────────────── */

export function explainRubric(zh: boolean): { criteria: RubricCriterionView[]; scores: RubricScoreView[] } {
  const pick = (text: L10n) => (zh ? text["zh-CN"] : text["en-US"]);
  return {
    criteria: explainItem.rubric.criteria.map((criterion) => ({ id: criterion.id, description: pick(criterion.description), weight: criterion.weight, mustMention: criterion.mustMention })),
    scores: [
      { id: "race", score: 1, evidence: zh ? "“worker 刚取走最后一个 URL 时队列是空的，但它还会放新链接回来”" : "“the queue is empty right after a worker takes the last URL, but it will still push new links”" },
      { id: "signal", score: 0.5, evidence: zh ? "“应该等所有线程都空闲”" : "“wait until every thread is idle”" },
      { id: "finally", score: 0 },
    ],
  };
}

export const explainAnswerText = {
  zh: "空队列只是这一瞬间没有排队的任务。worker 刚取走最后一个 URL 时队列是空的，但它还会放新链接回来，所以会提前结束。应该等所有线程都空闲了再结束。",
  en: "An empty queue only means nothing is waiting right now. The queue is empty right after a worker takes the last URL, but it will still push new links back, so the crawl stops early. You should wait until every thread is idle before finishing.",
};

/* ───────────────────────── Path ───────────────────────── */

type Bi = { zh: string; en: string };
const bi = (zh: string, en: string): Bi => ({ zh, en });

export type FixtureTier = { id: string; code: string; title: Bi; units: FixtureUnit[] };
export type FixtureUnit = Omit<UnitPathView, "title" | "goal" | "nodes" | "lockedAfter"> & {
  title: Bi;
  goal: Bi;
  lockedAfter?: Bi;
  nodes: (Omit<UnitPathView["nodes"][number], "title"> & { title: Bi })[];
};

export const pathTiers: FixtureTier[] = [
  {
    id: "t0",
    code: "T0",
    title: bi("基本功：Python 速写与测试反射", "Fluency: Python speed-writing and test reflexes"),
    units: [
      {
        id: "u-py-fluency",
        ordinal: 1,
        state: "complete",
        crowns: 3,
        cracked: true,
        title: bi("Python 速写与常见陷阱", "Python speed-writing and traps"),
        goal: bi("不查文档写出 dict / sort / 默认参数的正确用法", "Write dict, sort and default-argument idioms without the docs"),
        nodes: [
          { id: "u-py-fluency-l1", kind: "lesson", state: "complete", crowns: 3, minutes: 8, title: bi("dict 与排序反射", "Dict and sort reflexes") },
          { id: "u-py-fluency-l4", kind: "lesson", state: "complete", crowns: 2, cracked: true, minutes: 7, title: bi("别名与可变默认参数", "Aliasing and mutable defaults") },
          { id: "u-py-fluency-l6", kind: "lesson", state: "complete", crowns: 3, minutes: 9, title: bi("一分钱都不能差", "Not a cent off") },
          { id: "u-py-fluency-cp", kind: "checkpoint", state: "complete", crowns: 3, minutes: 25, title: bi("检查点：A1 L1–L2 限时阶梯", "Checkpoint: timed A1 L1–L2 ladder"), localOnly: true },
        ],
      },
      {
        id: "u-py-stdlib",
        ordinal: 2,
        state: "active",
        crowns: 1,
        title: bi("标准库工具箱：collections、heapq、bisect", "Stdlib toolbox: collections, heapq, bisect"),
        goal: bi("知道哪种容器能把 O(n) 变成 O(log n)", "Know which container turns O(n) into O(log n)"),
        nodes: [
          { id: "u-py-stdlib-l1", kind: "lesson", state: "complete", crowns: 1, minutes: 8, title: bi("Counter 与 defaultdict", "Counter and defaultdict") },
          { id: "u-py-stdlib-l3", kind: "lesson", state: "in-progress", minutes: 10, current: true, progress: { done: 3, total: 7 }, title: bi("堆：最小、最大与并列", "Heaps: min, max, ties") },
          { id: "u-py-stdlib-l4", kind: "lesson", state: "available", minutes: 9, title: bi("惰性删除", "Lazy deletion") },
          { id: "u-py-stdlib-l5", kind: "lesson", state: "available", minutes: 12, localOnly: true, title: bi("用 bisect 查历史版本", "bisect for history") },
          { id: "u-py-stdlib-cp", kind: "checkpoint", state: "locked", minutes: 30, title: bi("检查点：库存撮合阶梯", "Checkpoint: order-book ladder") },
        ],
      },
    ],
  },
  {
    id: "t1",
    code: "T1",
    title: bi("OOP 与方法契约设计", "OOP and method-contract design"),
    units: [
      {
        id: "u-oop-classes",
        ordinal: 3,
        state: "locked",
        crowns: 0,
        lockedAfter: bi("标准库工具箱", "Stdlib toolbox"),
        title: bi("类、封装与 Python 数据模型", "Classes, encapsulation and the data model"),
        goal: bi("让不变量只住在一个地方", "Keep every invariant in exactly one place"),
        nodes: [
          { id: "u-oop-classes-l1", kind: "lesson", state: "locked", minutes: 8, title: bi("不变量住在哪里", "Where invariants live") },
          { id: "u-oop-classes-l3", kind: "lesson", state: "locked", minutes: 9, title: bi("__eq__ 与 __hash__", "eq and hash") },
          { id: "u-oop-classes-cp", kind: "checkpoint", state: "locked", minutes: 30, title: bi("检查点：银行账户阶梯", "Checkpoint: bank account ladder") },
        ],
      },
    ],
  },
];

export function resolveUnit(unit: FixtureUnit, zh: boolean): UnitPathView {
  const pick = (value: Bi) => (zh ? value.zh : value.en);
  return {
    ...unit,
    title: pick(unit.title),
    goal: pick(unit.goal),
    lockedAfter: unit.lockedAfter ? pick(unit.lockedAfter) : undefined,
    nodes: unit.nodes.map((node) => ({ ...node, title: pick(node.title) })),
  };
}

/* ───────────────────────── Learner state ───────────────────────── */

export function sessionKcChanges(zh: boolean): SessionKcChange[] {
  return [
    { kcId: "py-mutable-default", title: zh ? "可变默认参数" : "Mutable default arguments", pBefore: 0.42, pAfter: 0.93, masteryBefore: 1, masteryAfter: 2 },
    { kcId: "time-half-open", title: zh ? "左闭右开的时间区间" : "Half-open time intervals", pBefore: 0.61, pAfter: 0.88, masteryBefore: 2, masteryAfter: 2 },
    { kcId: "cache-lru", title: zh ? "LRU 的两个 O(1) 操作" : "The two O(1) LRU operations", pBefore: 0.74, pAfter: 0.97, masteryBefore: 2, masteryAfter: 3 },
    { kcId: "sort-tiebreak", title: zh ? "排序时显式处理并列" : "Explicit tie-breaks when sorting", pBefore: 0.8, pAfter: 0.35, masteryBefore: 2, masteryAfter: 1 },
  ];
}

export function heatmapRows(zh: boolean, density: "empty" | "sparse" | "dense" = "dense"): KcHeatmapRow[] {
  const rows: { unitId: string; title: Bi; kcs: [string, Bi][] }[] = [
    { unitId: "u-py-fluency", title: bi("Python 速写与常见陷阱", "Python speed-writing and traps"), kcs: [
      ["py-dict-idioms", bi("dict 习语", "Dict idioms")], ["py-sort-keys", bi("排序键", "Sort keys")], ["py-none-falsy", bi("None 与假值", "None vs falsy")],
      ["py-aliasing", bi("别名", "Aliasing")], ["py-mutable-default", bi("可变默认参数", "Mutable defaults")], ["py-exceptions", bi("异常变 null", "Exceptions to null")], ["py-decimal", bi("金额精度", "Money precision")],
    ] },
    { unitId: "u-py-stdlib", title: bi("标准库工具箱", "Stdlib toolbox"), kcs: [
      ["std-counter", bi("Counter", "Counter")], ["std-deque", bi("deque", "deque")], ["std-heap-ties", bi("堆与并列", "Heaps and ties")], ["std-lazy-delete", bi("惰性删除", "Lazy deletion")],
      ["std-bisect", bi("bisect", "bisect")], ["std-itertools", bi("itertools", "itertools")],
    ] },
    { unitId: "u-bb-time", title: bi("时间语义", "Time semantics"), kcs: [
      ["time-half-open", bi("左闭右开", "Half-open intervals")], ["time-due-first", bi("先处理到期事件", "Due events first")], ["time-same-ts", bi("同一时间戳", "Same timestamp")], ["time-window", bi("窗口对齐", "Window alignment")],
    ] },
    { unitId: "u-conc-futures", title: bi("线程池、futures 与可靠终止", "Thread pools, futures and termination"), kcs: [
      ["conc-submit-map", bi("submit 与 map", "submit vs map")], ["conc-as-completed", bi("as_completed", "as_completed")], ["conc-bounded", bi("限制在途数", "Bounded in-flight")], ["conc-termination", bi("爬虫何时结束", "When the crawler stops")], ["conc-shutdown", bi("shutdown 与超时", "Shutdown and timeouts")],
    ] },
  ];
  const ps = [0.96, 0.82, 0.64, 0.38, 0.91, 0.73, 0.55, 0.88, 0.47, 0.99, 0.68, 0.79, 0.3, 0.86, 0.6, 0.93, 0.71, 0.52, 0.84, 0.44, 0.97, 0.66];
  let i = 0;
  return rows.map((row, rowIndex) => ({
    unitId: row.unitId,
    title: zh ? row.title.zh : row.title.en,
    cells: row.kcs.map(([id, title]) => {
      const index = i++;
      const unseen = density === "empty" || (density === "sparse" && (rowIndex > 1 || index % 3 === 2)) || (density === "dense" && rowIndex === 3 && index % 4 === 3);
      const p = unseen ? null : ps[index % ps.length]!;
      const mastery = (p === null ? 0 : Math.min(5, Math.max(0, Math.round(p * 5) - 1))) as 0 | 1 | 2 | 3 | 4 | 5;
      return { id, title: zh ? title.zh : title.en, p, mastery, due: p !== null && p < 0.7 };
    }),
  }));
}

export const fixtureNow = new Date("2026-10-05T09:00:00Z");

export function reviewEntries(zh: boolean): ReviewQueueEntry[] {
  const hours = (h: number) => new Date(fixtureNow.getTime() + h * 3_600_000).toISOString();
  return [
    { kcId: "sort-tiebreak", title: zh ? "排序时显式处理并列" : "Explicit tie-breaks when sorting", unitTitle: zh ? "Python 速写与常见陷阱" : "Python speed-writing and traps", p: 0.35, at: hours(52), state: "remedial" },
    { kcId: "std-lazy-delete", title: zh ? "惰性删除" : "Lazy deletion", unitTitle: zh ? "标准库工具箱" : "Stdlib toolbox", p: 0.38, at: hours(-30), state: "due" },
    { kcId: "time-same-ts", title: zh ? "同一时间戳的处理规则" : "Same-timestamp rules", unitTitle: zh ? "时间语义" : "Time semantics", p: 0.52, at: hours(-6), state: "due" },
    { kcId: "py-decimal", title: zh ? "金额精度" : "Money precision", unitTitle: zh ? "Python 速写与常见陷阱" : "Python speed-writing and traps", p: 0.64, at: hours(-1), state: "due" },
    { kcId: "conc-bounded", title: zh ? "限制在途任务数" : "Bounded in-flight work", unitTitle: zh ? "线程池、futures 与可靠终止" : "Thread pools, futures and termination", p: 0.74, at: hours(5), state: "upcoming" },
    { kcId: "time-half-open", title: zh ? "左闭右开的时间区间" : "Half-open time intervals", unitTitle: zh ? "时间语义" : "Time semantics", p: 0.88, at: hours(70), state: "upcoming" },
  ];
}

/** Strings a story picks by locale (content data, not UI copy). */
export const pickBi = (value: Bi, zh: boolean) => (zh ? value.zh : value.en);
