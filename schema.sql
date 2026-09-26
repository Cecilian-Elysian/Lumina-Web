-- ============================================================
-- Lumina D1 schema — 访客统计 + 图片点赞
-- ------------------------------------------------------------
-- 初始化:
--   本地: npx wrangler d1 execute lumina-db --local  --file schema.sql
--   线上: npx wrangler d1 execute lumina-db --remote --file schema.sql
--
-- 幂等:全部 IF NOT EXISTS,可重复执行。
-- 键约定:likes.url = Image.url(原图直链),与焦点/图集/标签一致。
-- ============================================================

-- 按天聚合的访问量(day = UTC 日期 'YYYY-MM-DD')
-- pv = 页面访问次数;uv = 独立访客数(按每日轮转 vid 去重)
CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  pv  INTEGER NOT NULL DEFAULT 0,
  uv  INTEGER NOT NULL DEFAULT 0
);

-- 每日访客指纹表(vid = sha256(IP + UA + day),不存原始 IP,次日自动失效)
CREATE TABLE IF NOT EXISTS visitors (
  day TEXT NOT NULL,
  vid TEXT NOT NULL,
  PRIMARY KEY (day, vid)
);

-- 图片点赞计数(url = 原图直链;MAX(0,…) 防止取消点赞后出现负数)
CREATE TABLE IF NOT EXISTS likes (
  url   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
