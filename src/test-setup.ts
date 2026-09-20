/* ============================================================
 * vitest setup — localStorage 垫片
 * ------------------------------------------------------------
 * Node 22+ 的实验性 webstorage 会抢占 globalThis.localStorage,
 * 在 --localstorage-file 无有效路径时它是不带任何方法的空壳,
 * 导致 jsdom 环境下 localStorage.clear/getItem 全部不存在。
 * 这里统一替换为 Map 实现(每个测试文件隔离,模块级单例)。
 * ============================================================ */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});
