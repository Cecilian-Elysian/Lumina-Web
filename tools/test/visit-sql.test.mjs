/* ============================================================
 * /api/visit 的 SQL 语义验证 —— 用【真 SQLite】而非 mock D1
 * ------------------------------------------------------------
 * 为什么必须真引擎:
 *   recordVisit() 把两条写压进一个 db.batch(),并用
 *   `VALUES (?1, 1, (SELECT changes()))` + `excluded.uv` 来推断
 *   「这次访问是不是新访客」。这个惯用法够聪明,字符串前缀分发的
 *   mock D1 无论对错都会「通过」,等于没测。
 *
 *   D1 底层就是 SQLite,所以这里直接用 Node 内置的 node:sqlite
 *   跑真实 SQL,验证三件事:
 *     1. 新访客 → PV+1 且 UV+1
 *     2. 同一指纹二次访问 → PV+1 但 UV 不变(changes() 必须是 0)
 *     3. 跨日 → 各自独立计 UV
 *   再验证原实现(3 次独立往返)在中途失败时会永久丢 UV,
 *   以证明改成单 batch 的必要性。
 * ============================================================ */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Vite 5 的内置模块清单里没有 node:sqlite,直接 import 会被解析失败;
// createRequire 绕过 Vite 的 import 分析,拿到真正的 Node 内置模块。
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const DAY = '2026-10-17';

let db;
beforeAll(() => {
  db = new DatabaseSync(':memory:');
  // 直接用项目真实的 schema.sql,避免测试与线上表结构漂移
  db.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
});

/** 与 recordVisit() 完全一致的两条语句 */
const WRITE_SQL = [
  'INSERT INTO visitors (day, vid) VALUES (?1, ?2) ON CONFLICT (day, vid) DO NOTHING',
  'INSERT INTO daily_stats (day, pv, uv) VALUES (?1, 1, (SELECT changes())) ' +
    'ON CONFLICT (day) DO UPDATE SET pv = daily_stats.pv + 1, uv = daily_stats.uv + excluded.uv',
];

function record(day, vid) {
  db.prepare(WRITE_SQL[0]).run(day, vid);
  db.prepare(WRITE_SQL[1]).run(day);
}

function stats(day) {
  return db.prepare('SELECT pv, uv FROM daily_stats WHERE day = ?1').get(day)
    || { pv: 0, uv: 0 };
}

describe('visit 写入的真实 SQL 语义', () => {
  it('新访客:PV+1 且 UV+1', () => {
    record(DAY, 'vid-A');
    expect(stats(DAY)).toEqual({ pv: 1, uv: 1 });
  });

  it('同一指纹二次访问:PV+1 但 UV 不变(changes() 必须读到 0)', () => {
    record(DAY, 'vid-A');
    record(DAY, 'vid-A');
    record(DAY, 'vid-A');
    expect(stats(DAY)).toEqual({ pv: 4, uv: 1 });
  });

  it('另一个访客:PV 与 UV 同时 +1', () => {
    record(DAY, 'vid-B');
    expect(stats(DAY)).toEqual({ pv: 5, uv: 2 });
  });

  it('跨日:UV 按日独立重置', () => {
    record('2026-10-18', 'vid-A');
    record('2026-10-18', 'vid-C');
    expect(stats('2026-10-18')).toEqual({ pv: 2, uv: 2 });
    expect(stats(DAY)).toEqual({ pv: 5, uv: 2 }); // 前一天不受影响
  });

  it('一次性插入 200 个不同访客 → UV=200,重复插同一批 → UV 不变', () => {
    const d = '2026-10-19';
    for (let i = 0; i < 200; i++) record(d, 'bulk-' + i);
    expect(stats(d)).toEqual({ pv: 200, uv: 200 });
    for (let i = 0; i < 200; i++) record(d, 'bulk-' + i);
    expect(stats(d)).toEqual({ pv: 400, uv: 200 });
  });
});

describe('为什么必须是单个 batch(原实现的风险)', () => {
  it('原实现:指纹写成功、聚合计数写失败 → 该访客 UV 永久丢失', () => {
    const d = '2026-10-20';
    // 原实现的两个独立语句;这里只跑第一条,模拟第二条失败
    db.prepare('INSERT INTO visitors (day, vid) VALUES (?1, ?2) ON CONFLICT (day, vid) DO NOTHING')
      .run(d, 'lost-uv');
    // daily_stats 没有对应行 → UV 永远没被记上
    expect(stats(d)).toEqual({ pv: 0, uv: 0 });
    // 同一访客再次来访:指纹已存在 → 不再算新访客 → UV 仍为 0
    record(d, 'lost-uv');
    expect(stats(d)).toEqual({ pv: 1, uv: 0 });
    // ↑ 这就是「永久丢失」:换成单 batch 后,第二条失败会整批回滚,
    //   指纹不会留下,下次来访仍会被计为新访客。
  });

  it('单 batch 内第二条失败会回滚第一条(事务性)', () => {
    const d = '2026-10-21';
    try {
      db.exec('BEGIN');
      db.prepare(WRITE_SQL[0]).run(d, 'rollback-vid');
      db.prepare('INSERT INTO daily_stats (day, pv) VALUES (?1, 1, 2, 3)').run(d); // 故意列数不符
      db.exec('COMMIT');
    } catch {
      db.exec('ROLLBACK');
    }
    expect(stats(d)).toEqual({ pv: 0, uv: 0 });
    const n = db.prepare('SELECT COUNT(*) AS c FROM visitors WHERE day = ?1 AND vid = ?2')
      .get(d, 'rollback-vid');
    expect(n.c).toBe(0); // 指纹也没留下 → 下次来访仍算新访客
  });
});
