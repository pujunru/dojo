/**
 * Where the learner document lives, and the one writer that changes it.
 *
 * The document is a single JSON value (`learner-db.ts`). A `StorageBackend`
 * loads and saves it: IndexedDB in the browser, memory in tests or when the
 * browser refuses storage (private mode). Writes are serialised through one
 * queue, so two quick answers can never interleave and lose an update.
 */
import { emptyLearnerDb, type LearnerDb } from "./learner-db";

export interface StorageBackend {
  load(): Promise<LearnerDb | null>;
  save(db: LearnerDb): Promise<void>;
  /** False when progress will not survive a reload (shown to the learner). */
  readonly durable: boolean;
}

export class MemoryBackend implements StorageBackend {
  readonly durable = false;
  private value: LearnerDb | null;
  constructor(initial: LearnerDb | null = null) {
    this.value = initial;
  }
  async load() {
    return this.value;
  }
  async save(db: LearnerDb) {
    this.value = db;
  }
}

const DB_NAME = "dojo";
const STORE = "learner";
const KEY = "default";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbBackend implements StorageBackend {
  readonly durable = true;
  private db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const open = factory.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("blocked"));
    });
  }

  async load(): Promise<LearnerDb | null> {
    const db = await this.db;
    const value = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
    return (value as LearnerDb | undefined) ?? null;
  }

  async save(value: LearnerDb): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

export class LearnerStore {
  private current: Promise<LearnerDb>;
  private tail: Promise<unknown> = Promise.resolve();
  readonly backend: StorageBackend;

  constructor(backend: StorageBackend) {
    this.backend = backend;
    this.current = backend.load().then((db) => db ?? emptyLearnerDb());
  }

  /** The document as of the last completed write. */
  read(): Promise<LearnerDb> {
    return this.tail.then(() => this.current);
  }

  /**
   * Applies `op` to the latest document and saves the result. Ops run one at
   * a time in call order; an op that throws leaves the document unchanged.
   */
  write<R>(op: (db: LearnerDb) => { db: LearnerDb; result: R }): Promise<R> {
    const run = this.tail.then(async () => {
      const before = await this.current;
      const { db, result } = op(before);
      if (db !== before) {
        await this.backend.save(db);
        this.current = Promise.resolve(db);
      }
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

let store: LearnerStore | null = null;

/** The app's store: IndexedDB when the browser allows it, memory otherwise. */
export function getLearnerStore(): LearnerStore {
  if (!store) {
    let backend: StorageBackend;
    try {
      backend = typeof indexedDB !== "undefined" ? new IndexedDbBackend() : new MemoryBackend();
    } catch {
      backend = new MemoryBackend();
    }
    store = new LearnerStore(backend);
    // A browser that refuses IndexedDB (some private modes) still gets a working session.
    store.read().catch(() => {
      store = new LearnerStore(new MemoryBackend());
    });
  }
  return store;
}

/** Tests and the import flow: swap the store's backend. */
export function setLearnerStore(next: LearnerStore) {
  store = next;
}
