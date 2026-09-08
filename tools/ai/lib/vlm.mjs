/* ============================================================
 * Lumina AI — MiniMax VLM 客户端
 * ------------------------------------------------------------
 * 通过 HTTP REST 调用 MiniMax 视觉模型识别动漫角色。
 * 不引第三方 SDK(避免锁死供应商),只依赖 Node 内置 fetch。
 *
 * 用法:
 *   import { recognizeCharacter, buildAllowlist } from './lib/vlm.mjs';
 *   const tag = await recognizeCharacter({
 *     imageBase64, mimeType,
 *     allowlist, apiKey,
 *   });
 *
 * API key 来源:
 *   1. process.env.MINIMAX_API_KEY
 *   2. ../.dev.vars (由 config-reader.readLocalSecret 读取)
 * ============================================================ */

const DEFAULT_BASE = 'https://api.MiniMax.chat/v1';
const DEFAULT_MODEL = 'MiniMax-M3';

/**
 * 把 CONFIG.characters 过滤成允许表(去掉无名项)。
 */
export function buildAllowlist(characters) {
  return (characters || []).filter((c) => c && typeof c.name === 'string' && c.name.length > 0);
}

/**
 * 构造 constrained 模式 prompt:让 VLM 只从 allowlist 里选。
 */
function buildPromptForConstrained(allowlist) {
  const lines = allowlist
    .map((c) => {
      const aliases = (c.aliases && c.aliases.length > 0) ? ' (' + c.aliases.join(', ') + ')' : '';
      return '  - ' + c.name + aliases;
    })
    .join('\n');
  return [
    '你是一个动漫角色识别助手。请从下列【允许的角色列表】中选出图中出现的角色。',
    '如果图中没有任何允许列表中的角色,只回复:NONE',
    '否则只回复角色中文全名,不要多余文字、不要标点、不要解释。',
    '',
    '允许的角色列表:',
    lines,
  ].join('\n');
}

/**
 * 构造 open 模式 prompt:不限制角色库,让 VLM 自由识别图中角色。
 * 返回的 reply 由上游脚本聚合去重 + 用 prts.wiki 别名表归一化。
 */
function buildPromptForOpen() {
  return [
    '你是一个动漫/游戏角色识别助手。请告诉我图中角色的全名。',
    '优先级: 中文全名 > 英文全名 > 日文/罗马音。',
    '如果图中没有具体角色(路人、风景、物品、UI 截图、文字插画等),只回复:NONE',
    '只回名字,不要解释、不要标点、不要 JSON、不要 Markdown。',
  ].join('\n');
}

/**
 * 调 MiniMax VLM,返回角色名或 null。
 *
 * @param {Object} opts
 * @param {string} opts.imageBase64  base64 编码(不含 data: 前缀)
 * @param {string} [opts.mimeType='image/jpeg']
 * @param {Array<{name:string,aliases?:string[]}>} [opts.allowlist]  constrained 模式必填
 * @param {'constrained'|'open'} [opts.mode='constrained']  open 模式跳过 allowlist 校验,自由识别
 * @param {string} opts.apiKey
 * @param {string} [opts.model='MiniMax-M3']
 * @param {string} [opts.apiBase='https://api.MiniMax.chat/v1']
 * @returns {Promise<string|null>} constrained: name 或 null;open: 原始 reply(可能含 NONE)
 */
export async function recognizeCharacter(opts) {
  const {
    imageBase64,
    mimeType = 'image/jpeg',
    allowlist,
    apiKey,
    model = DEFAULT_MODEL,
    apiBase = DEFAULT_BASE,
    mode = 'constrained',
  } = opts || {};

  if (!apiKey) throw new Error('MiniMax API key 未配置');
  if (!imageBase64) throw new Error('imageBase64 缺失');
  if (mode === 'constrained') {
    if (!Array.isArray(allowlist) || allowlist.length === 0) {
      throw new Error('allowlist 为空;请在 CONFIG.characters 中维护角色名单');
    }
  }

  const prompt = mode === 'open'
    ? buildPromptForOpen()
    : buildPromptForConstrained(allowlist);
  const url = apiBase.replace(/\/+$/, '') + '/chat/completions';

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + imageBase64 } },
          ],
        }],
        // 推理模型(MiniMax-M3)会输出 <think>...</think> 块后再给结论,
        // max_tokens 留足空间容纳推理+结论;默认 1024 足够
        max_tokens: 1024,
        temperature: 0,
      }),
    });
  } catch (e) {
    throw new Error('MiniMax 请求失败: ' + (e && e.message ? e.message : String(e)));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('MiniMax HTTP ' + res.status + ': ' + text.slice(0, 200));
  }

  const json = await res.json().catch(() => null);
  // 兼容两种响应位置:有的 API 把推理放 reasoning_content,有的直接拼到 content 前面
  const message = json && json.choices && json.choices[0] && json.choices[0].message;
  let reply = (message && (message.content || message.reasoning_content || '')).trim();
  // 去掉 <think>...</think> 块(推理模型会把思考过程放这里)
  reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (!reply) throw new Error('MiniMax 响应无 content');
  if (/^NONE$/i.test(reply)) return null;

  // open 模式:不做 allowlist 匹配,直接返回原始 reply
  // (上游脚本负责聚合 + 用 prts.wiki 别名表归一化)
  if (mode === 'open') return reply;

  // constrained 模式:精确匹配 name 或任一 alias
  let hit = allowlist.find((c) => c.name === reply || (c.aliases || []).includes(reply));
  if (hit) return hit.name;

  // 容错:去标点/去空白后匹配
  const norm = (s) => String(s || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const replyNorm = norm(reply);
  hit = allowlist.find((c) => norm(c.name) === replyNorm);
  if (hit) return hit.name;

  // 再容错:reply 是 name 的前缀(去标点后)
  hit = allowlist.find((c) => norm(c.name).startsWith(replyNorm) && replyNorm.length >= 2);
  if (hit) return hit.name;

  // 实在匹配不上,返回原始 reply(让上游知道 VLM 给的是什么);
  // 上游会判定不在 allowlist,归入"未分类"。
  return reply;
}