/* ============================================================
 * 操作队列 — 全局"待保存文件"登记 + 批量保存
 * ------------------------------------------------------------
 * 借鉴 Cecilian-Hub 控制台的操作队列模式:
 *   各 Tab 编辑只改本地(LS),并把 dirty 状态登记到这里;
 *   顶栏(侧栏)统一「保存全部 / 保存并部署」,一次确认批量落盘,
 *   替代旧版每个 Tab 手动两步(💾 保存 → ↥ 同步并部署)。
 * ============================================================ */
import { ref, computed } from 'vue';

/** 四个可保存的数据文件(与 Tab key 对应) */
export type FileKey = 'focal' | 'album' | 'tags' | 'config';

export const DATA_FILES: Record<FileKey, string> = {
  focal: 'src/site/focalPoints.ts',
  album: 'src/site/albums.ts',
  tags: 'src/site/tags.ts',
  config: 'src/site/config.ts',
};

export const FILE_LABELS: Record<FileKey, string> = {
  focal: '焦点',
  album: '图集',
  tags: '标签',
  config: '配置',
};

const dirtyMap = ref<Record<FileKey, boolean>>({
  focal: false,
  album: false,
  tags: false,
  config: false,
});

/** 各 Tab 在编辑变化时调用(vue watchEffect 内) */
export function setDirty(key: FileKey, dirty: boolean) {
  dirtyMap.value[key] = dirty;
}

/** 有未保存改动的文件 key 列表 */
export const dirtyFiles = computed<FileKey[]>(() =>
  (Object.keys(dirtyMap.value) as FileKey[]).filter((k) => dirtyMap.value[k]));

/** 待保存文件数(侧栏红点/文案) */
export const dirtyCount = computed(() => dirtyFiles.value.length);

export function fileOf(key: FileKey): string {
  return DATA_FILES[key];
}

/** Tab 注册的落盘函数:无确认、无部署;true = 已保存(或无需保存) */
type SaverFn = () => Promise<boolean>;

const savers = new Map<FileKey, SaverFn>();

/** Tab setup 时调用一次(四个 Tab 常驻挂载,注册稳定) */
export function registerSaver(key: FileKey, fn: SaverFn) {
  savers.set(key, fn);
}

/** 批量保存全部 dirty 文件(顺序执行);返回实际保存成功的 key 列表 */
export async function saveAll(): Promise<FileKey[]> {
  const saved: FileKey[] = [];
  for (const key of dirtyFiles.value) {
    const fn = savers.get(key);
    if (!fn) continue;
    if (await fn()) saved.push(key);
  }
  return saved;
}
