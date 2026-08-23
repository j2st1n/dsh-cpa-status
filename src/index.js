/**
 * dsh-cpa-status — Host half (M1.5).
 *
 * 本机 HTTP 路由（loopback，Cache-Control: no-store）：
 *   GET  /api/cpa-status          摘要（mode 驱动 UI 双态）
 *   GET  /api/cpa-status/config   脱敏配置（供配置卡回填）
 *   PUT  /api/cpa-status/config   创建/更新配置（留空保密钥，保存后探测）
 *   GET  /api/cpa-status/accounts 账号明细（认证文件 + AI 供应商网关；默认只回 auth-files 数据
 *                                  + 本地配额缓存，`?quota=1` 才触发上游配额探针——限额同步是手动操作）
 *
 * 数据源（全部 CPA Management API）：
 *   GET  /v0/management/auth-files   可达性 / 账号池 / 请求计数 / recent_requests 桶
 *   POST /v0/management/api-call     按账号探针上游配额（header 用 `$TOKEN$` 占位符，CPA 侧注入真实凭证）
 *
 * 安全：management key 只存 Host credentials；任何响应不回传完整密钥与上游原始 body；
 * 不代理 api-keys 等返回原始密钥的端点；账号行只回白名单字段。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'cpa-status'
export const inject = ['settings', 'credentials', 'webServer']

const NS = /** @type {any} */ ('cpa-status')
const KEY_REF = /** @type {any} */ ('CPA_MANAGEMENT_KEY')

/** 上游 auth-files 探测缓存：常驻卡片轮询不直接打 CPA。 */
const PROBE_CACHE_TTL_MS = 15_000
/** 配额探针成本高（每账号一次 api-call），缓存更久。 */
const QUOTA_CACHE_TTL_MS = 120_000
const QUOTA_PROBE_CONCURRENCY = 3
/** 单账号 recent_requests 是 10 分钟桶；近 30 分钟 = 最近 3 桶。 */
const TRAFFIC_BUCKETS = 3
const REQUEST_TIMEOUT_MS = 10_000

const schema = z.object({
  baseUrl: z.string().default(''),
  publicUrl: z.string().default(''),
  // 脱敏模式：显示层打码（邮箱/地址/账号名/密钥提示），数据本身不受影响
  privacyMode: z.boolean().default(false),
})

// ---------------------------------------------------------------------------
// URL 工具
// ---------------------------------------------------------------------------

/** 去掉首尾空白与尾部斜杠；非法 URL 原样返回（由 isAbsoluteHttpUrl 判定）。 */
function normalizeBase(input) {
  return String(input ?? '').trim().replace(/\/+$/, '')
}

function isAbsoluteHttpUrl(input) {
  try {
    const u = new URL(input)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function mgmtUrl(baseUrl, path) {
  return `${normalizeBase(baseUrl)}/v0/management${path}`
}

/** 规范化用于比较：小写协议/host，去默认端口，去尾部斜杠。 */
function normalizeForCompare(input) {
  try {
    const u = new URL(normalizeBase(input))
    const defaultPort = u.protocol === 'https:' ? '443' : '80'
    const port = u.port === defaultPort ? '' : u.port
    const host = `${u.protocol}//${u.hostname.toLowerCase()}${port ? `:${port}` : ''}`
    return `${host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return normalizeBase(input).toLowerCase()
  }
}

/** 提取根域名 / 主机名（支持常见双层顶级域如 .com.cn / .org.cn / .co.uk / .com.hk 等）。 */
function extractApexDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return ''
  const host = hostname.toLowerCase().trim()
  // IP 形式（IPv4 / IPv6）或无点主机名（localhost 等）不作分段截取
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) {
    return host
  }
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const secondLevelTlds = new Set(['com', 'edu', 'gov', 'net', 'org', 'co', 'ac'])
  const tld = parts[parts.length - 1]
  const sld = parts[parts.length - 2]
  if (parts.length >= 3 && secondLevelTlds.has(sld) && tld.length <= 3) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

/** 判断两 URL 是否指向同一根域名或同机环境（主域名相同、host 相同或均为 localhost/环回地址）。 */
function isSameRootDomain(urlA, urlB) {
  try {
    const uA = new URL(normalizeBase(urlA))
    const uB = new URL(normalizeBase(urlB))
    const hostA = uA.hostname.toLowerCase()
    const hostB = uB.hostname.toLowerCase()
    if (hostA === hostB) return true
    const isLocalA = hostA === 'localhost' || hostA === '127.0.0.1' || hostA === '::1'
    const isLocalB = hostB === 'localhost' || hostB === '127.0.0.1' || hostB === '::1'
    if (isLocalA && isLocalB) return true
    const apexA = extractApexDomain(hostA)
    const apexB = extractApexDomain(hostB)
    return !!(apexA && apexB && apexA === apexB)
  } catch {
    return false
  }
}

/** 路由命中：endpoint 与 CPA base / publicUrl 相同，或为其子路径，或位于同一根域名/同机环境。 */
function endpointMatchesCpa(endpoint, ...candidateUrls) {
  const epNorm = normalizeForCompare(endpoint)
  for (const candidate of candidateUrls) {
    if (!candidate) continue
    const baseNorm = normalizeForCompare(candidate)
    if (epNorm === baseNorm || epNorm.startsWith(`${baseNorm}/`)) {
      return true
    }
    if (isSameRootDomain(endpoint, candidate)) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// auth-files 汇总
// ---------------------------------------------------------------------------

/** GET /v0/management/auth-files 探测；返回 { ok, files } 或 { ok:false, code, message }。 */
async function probeAuthFiles(baseUrl, key) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(mgmtUrl(baseUrl, '/auth-files'), {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'CPA_AUTH', message: `管理密钥无效（HTTP ${res.status}）` }
    }
    if (!res.ok) {
      return { ok: false, code: 'CPA_ERROR', message: `CPA 返回 HTTP ${res.status}` }
    }
    const data = await res.json()
    const files = Array.isArray(data?.files) ? data.files : []
    return { ok: true, files }
  } catch (error) {
    return { ok: false, code: 'CPA_UNREACHABLE', message: `CPA 不可达：${error?.message ?? error}` }
  } finally {
    clearTimeout(timer)
  }
}

/** auth-files → 账号池计数与问题列表（全部脱敏：不携带 token/cookie/path）。 */
function summarizeAccounts(files) {
  const okCount = files.filter((f) => !f.disabled && !f.unavailable).length
  const issues = files
    .filter((f) => f.disabled || f.unavailable || (typeof f.status === 'string' && f.status !== 'active'))
    .map((f) => ({
      id: String(f.name ?? f.id ?? f.label ?? 'unknown'),
      kind: f.disabled ? 'disabled' : f.unavailable ? 'error' : 'auth',
      summary: String(f.status_message || f.status || ''),
    }))
  return { accountsOk: okCount, accountsTotal: files.length, issues }
}

/** recent_requests（10 分钟桶）→ 近 30 分钟流量；字段缺失返回 null。 */
function summarizeTraffic(files) {
  let requests = 0
  let success = 0
  let supported = false
  for (const f of files) {
    if (!Array.isArray(f.recent_requests)) continue
    supported = true
    for (const bucket of f.recent_requests.slice(-TRAFFIC_BUCKETS)) {
      requests += (bucket.success | 0) + (bucket.failed | 0)
      success += bucket.success | 0
    }
  }
  if (!supported) return null
  return {
    windowSec: TRAFFIC_BUCKETS * 600,
    requests,
    successRate: requests > 0 ? success / requests : 1,
    source: 'auth-files',
  }
}

/**
 * recent_requests 全量桶 → 健康刻度带数据（逐桶成败 + 窗口成功率 + 跨度文本）。
 * 桶为 10 分钟粒度（time 形如 '12:40-12:50'），20 桶 ≈ 最近 3.3 小时。
 */
function healthFromRecent(recent) {
  const buckets = (Array.isArray(recent) ? recent : []).map((b) => ({
    time: String(b?.time ?? ''),
    ok: Math.max(0, Number(b?.success) || 0),
    failed: Math.max(0, Number(b?.failed) || 0),
  }))
  if (!buckets.length) return { spanText: '', successRate: null, buckets: [] }
  const ok = buckets.reduce((s, b) => s + b.ok, 0)
  const failed = buckets.reduce((s, b) => s + b.failed, 0)
  const reqs = ok + failed
  const minutes = buckets.length * 10
  const hours = minutes / 60
  const spanText = minutes < 60 ? `${minutes} 分钟` : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`
  return { spanText, successRate: reqs > 0 ? ok / reqs : null, buckets }
}

// ---------------------------------------------------------------------------
// AI 供应商网关（api-key 型，区别于 OAuth 认证文件）
// ---------------------------------------------------------------------------

/** CPA 配置里的 api-key 型上游网关端点（只读）。 */
const GATEWAY_ENDPOINTS = [
  'gemini-api-key',
  'claude-api-key',
  'codex-api-key',
  'xai-api-key',
  'openai-compatibility',
  'vertex-api-key',
  'interactions-api-key',
]

/** 密钥脱敏：只留末四位。 */
function maskKey(k) {
  const s = String(k ?? '')
  return s.length > 4 ? `••••${s.slice(-4)}` : '••••'
}

/** 网关条目 → 白名单形状；原始 api-key 绝不进返回值。 */
function sanitizeGatewayEntry(type, e) {
  if (typeof e === 'string') {
    return { type, name: null, disabled: false, baseUrl: null, keys: [{ hint: maskKey(e), authIndex: null }], models: [] }
  }
  if (!e || typeof e !== 'object') return null
  const keys = []
  if (typeof e['api-key'] === 'string' && e['api-key']) {
    keys.push({ hint: maskKey(e['api-key']), authIndex: e['auth-index'] ?? null })
  }
  for (const k of Array.isArray(e['api-key-entries']) ? e['api-key-entries'] : []) {
    keys.push({ hint: maskKey(k?.['api-key']), authIndex: k?.['auth-index'] ?? null })
  }
  const models = (Array.isArray(e.models) ? e.models : [])
    .map((m) => ({ name: String(m?.name ?? m ?? ''), alias: m?.alias ? String(m.alias) : null }))
    .filter((m) => m.name)
  return {
    type,
    name: e.name ? String(e.name) : null,
    disabled: !!e.disabled,
    baseUrl: e['base-url'] ? String(e['base-url']) : null,
    keys,
    models,
  }
}

/** 并行读取全部网关类型；单类型失败不拖垮整体（记入 failedTypes）。 */
async function probeGateways(baseUrl, key) {
  const results = await Promise.all(
    GATEWAY_ENDPOINTS.map(async (ep) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(mgmtUrl(baseUrl, `/${ep}`), {
          headers: { authorization: `Bearer ${key}` },
          signal: ctrl.signal,
        })
        if (!res.ok) return { ep, failed: true, entries: [] }
        const data = await res.json()
        const list = Array.isArray(data?.[ep]) ? data[ep] : []
        return { ep, failed: false, entries: list.map((e) => sanitizeGatewayEntry(ep, e)).filter(Boolean) }
      } catch {
        return { ep, failed: true, entries: [] }
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  return {
    gateways: results.flatMap((r) => r.entries),
    failedTypes: results.filter((r) => r.failed).map((r) => r.ep),
  }
}

// ---------------------------------------------------------------------------
// 配额探针（provider → api-call 目标与解析器）
// ---------------------------------------------------------------------------

/** 窗口秒数 → 短标签。 */
function windowLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '窗口'
  if (seconds % 604800 === 0) return 'Weekly'
  if (seconds % 86400 === 0) return `${seconds / 86400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${Math.round(seconds / 60)}m`
}

const toInt = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** codex: chatgpt.com/backend-api/wham/usage */
function parseCodexQuota(body) {
  const windows = []
  const push = (label, w) => {
    const usedPct = toInt(w?.used_percent)
    if (usedPct === null) return
    windows.push({
      label,
      remainingPct: Math.max(0, Math.min(100, 100 - usedPct)),
      resetAt: typeof w.reset_at === 'number' ? w.reset_at * 1000 : null,
    })
  }
  const rl = body?.rate_limit
  if (rl?.primary_window) push(windowLabel(rl.primary_window.limit_window_seconds), rl.primary_window)
  if (rl?.secondary_window) push(`${windowLabel(rl.secondary_window.limit_window_seconds)}（次）`, rl.secondary_window)
  for (const extra of body?.additional_rate_limits ?? []) {
    const w = extra?.rate_limit?.primary_window
    if (w) push(String(extra.limit_name ?? '模型'), w)
  }
  const plan = typeof body?.plan_type === 'string' ? body.plan_type : null
  return { plan, windows }
}

/** kimi: api.kimi.com/coding/v1/usages */
function parseKimiQuota(body) {
  const windows = []
  const push = (label, detail) => {
    const limit = toInt(detail?.limit)
    const remaining = toInt(detail?.remaining)
    if (limit === null || remaining === null || limit <= 0) return
    const resetAt = detail?.resetTime ? Date.parse(detail.resetTime) : NaN
    windows.push({
      label,
      remainingPct: Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))),
      resetAt: Number.isNaN(resetAt) ? null : resetAt,
    })
  }
  if (body?.usage) push('Weekly', body.usage)
  for (const item of body?.limits ?? []) {
    const durMin = item?.window?.timeUnit === 'TIME_UNIT_MINUTE' ? toInt(item?.window?.duration) : null
    const label = durMin === null ? '窗口' : durMin % 10080 === 0 ? 'Weekly' : durMin % 1440 === 0 ? `${durMin / 1440}d` : `${Math.round(durMin / 60)}h`
    push(label, item?.detail)
  }
  const level = body?.user?.membership?.level
  const plan = typeof level === 'string' ? level.replace(/^LEVEL_/, '').toLowerCase() : null
  return { plan, windows }
}

/** xai: cli-chat-proxy.grok.com/v1/billing?format=credits */
function parseXaiQuota(body) {
  const cfg = body?.config
  const windows = []
  const period = cfg?.currentPeriod
  if (period) {
    const resetAt = period.end ? Date.parse(period.end) : NaN
    const reset = Number.isNaN(resetAt) ? null : resetAt
    const toPct = (v) => {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(100 - n))) : null
    }
    // 周限额：creditUsagePercent 是「已用 %」（统一计费用户的真实配额池）
    const usedPct = toPct(cfg?.creditUsagePercent)
    windows.push({
      label: period.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? 'Weekly' : 'Period',
      remainingPct: usedPct,
      resetAt: reset,
    })
    // 产品维度（GrokBuild 等）：仅在与整体用量不同的时候才单列，避免重复条
    for (const p of Array.isArray(cfg?.productUsage) ? cfg.productUsage : []) {
      const pct = toPct(p?.usagePercent)
      if (p?.product && pct !== null && pct !== usedPct) {
        windows.push({ label: String(p.product), remainingPct: pct, resetAt: reset })
      }
    }
    // 按量付费：仅启用时（cap>0）展示；未启用（cap=0）不渲染死行
    const cap = toInt(cfg?.onDemandCap?.val)
    const used = toInt(cfg?.onDemandUsed?.val)
    if (cap !== null && cap > 0 && used !== null) {
      windows.push({ label: '按量付费', remainingPct: Math.max(0, Math.round(((cap - used) / cap) * 100)), resetAt: reset })
    }
  }
  return { plan: null, windows }
}

function formatAntigravityGroup(name) {
  const s = String(name ?? '').toUpperCase()
  if (s.includes('GEMINI')) return 'Gemini'
  if (s.includes('CLAUDE') && s.includes('GPT')) return 'Claude/GPT'
  if (s.includes('CLAUDE')) return 'Claude'
  if (s.includes('GPT')) return 'GPT'
  return String(name ?? '模型组').replace(/模型/g, '').trim() || '通用'
}

function formatAntigravityWindow(window, displayName, bucketId) {
  const s = `${window ?? ''} ${displayName ?? ''} ${bucketId ?? ''}`.toLowerCase()
  if (s.includes('five') || s.includes('5h') || s.includes('5_hour') || s.includes('5-hour')) return '5h'
  if (s.includes('week') || s.includes('7d')) return 'Weekly'
  if (s.includes('day') || s.includes('24h') || s.includes('1d')) return '1d'
  return window || displayName || '窗口'
}

function windowSortWeight(label) {
  const s = String(label ?? '').toLowerCase()
  if (s.includes('5h') || s.includes('five')) return 0
  if (s.includes('1d') || s.includes('day') || s.includes('24h')) return 1
  if (s.includes('weekly') || s.includes('week') || s.includes('7d')) return 2
  return 3
}

/** antigravity: cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary（分组配额池） */
function parseAntigravityQuota(body) {
  const windows = []
  if (Array.isArray(body?.groups) && body.groups.length > 0) {
    for (const g of body.groups) {
      const groupLabel = formatAntigravityGroup(g.displayName)
      const sortedBuckets = (Array.isArray(g.buckets) ? [...g.buckets] : []).sort((a, b) => {
        const la = formatAntigravityWindow(a.window, a.displayName, a.bucketId)
        const lb = formatAntigravityWindow(b.window, b.displayName, b.bucketId)
        return windowSortWeight(la) - windowSortWeight(lb)
      })
      for (const b of sortedBuckets) {
        const frac = Number(b.remainingFraction)
        const pct = Number.isFinite(frac) ? Math.max(0, Math.min(100, Math.round(frac * 100))) : null
        const winLabel = formatAntigravityWindow(b.window, b.displayName, b.bucketId)
        const resetAt = b.resetTime ? Date.parse(b.resetTime) : NaN
        windows.push({
          label: `${groupLabel} · ${winLabel}`,
          remainingPct: pct,
          resetAt: Number.isNaN(resetAt) ? null : resetAt,
        })
      }
    }
  } else if (body?.models && typeof body.models === 'object') {
    const priorityKeys = [
      ['gemini-3-pro', 'Gemini 3 Pro'],
      ['claude', 'Claude Sonnet'],
      ['gemini-3-flash', 'Gemini 3 Flash'],
      ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ]
    const entries = Object.entries(body.models)
    for (const [keyPattern, displayLabel] of priorityKeys) {
      const match = entries.find(([name]) => name.toLowerCase().includes(keyPattern))
      if (match) {
        const [, info] = match
        const q = info?.quotaInfo
        if (q && q.remainingFraction !== undefined && q.remainingFraction !== null) {
          const frac = Number(q.remainingFraction)
          const pct = Number.isFinite(frac) ? Math.max(0, Math.min(100, Math.round(frac * 100))) : null
          const resetAt = q.resetTime ? Date.parse(q.resetTime) : NaN
          windows.push({
            label: info.displayName || displayLabel,
            remainingPct: pct,
            resetAt: Number.isNaN(resetAt) ? null : resetAt,
          })
        }
      }
    }
  }
  let plan = null
  if (typeof body?.tier === 'string') plan = body.tier
  else if (typeof body?.currentTier?.name === 'string') plan = body.currentTier.name
  else if (typeof body?.paidTier?.name === 'string') plan = body.paidTier.name
  return { plan, windows }
}

const QUOTA_PROBES = {
  codex: {
    url: 'https://chatgpt.com/backend-api/wham/usage',
    header: {
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'User-Agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
    },
    parse: parseCodexQuota,
  },
  kimi: {
    url: 'https://api.kimi.com/coding/v1/usages',
    header: { Authorization: 'Bearer $TOKEN$' },
    parse: parseKimiQuota,
  },
  xai: {
    url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
    header: {
      Authorization: 'Bearer $TOKEN$',
      'x-xai-token-auth': 'xai-grok-cli',
      'x-grok-client-version': '0.2.91',
      accept: '*/*',
      'user-agent': 'grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)',
    },
    parse: parseXaiQuota,
  },
  antigravity: {
    url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
    method: 'POST',
    header: {
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity/1.0.0',
    },
    body: {},
    parse: parseAntigravityQuota,
  },
}

/** POST /v0/management/api-call 配额探针；只回白名单解析结果，绝不回传上游原始 body。 */
async function probeQuota(baseUrl, key, authIndex, probe) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const payload = {
      authIndex,
      method: probe.method || 'GET',
      url: probe.url,
      header: probe.header,
    }
    if (probe.body !== undefined) {
      payload.body = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body)
    }
    const res = await fetch(mgmtUrl(baseUrl, '/api-call'), {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (res.status === 401 || res.status === 403) return { ok: false, message: '管理密钥无效' }
    if (!res.ok) return { ok: false, message: `CPA 返回 HTTP ${res.status}` }
    const data = await res.json()
    const code = Number(data?.status_code ?? 0)
    if (code === 401 || code === 403) return { ok: false, message: '上游凭证鉴权失败' }
    if (code < 200 || code >= 300) return { ok: false, message: `上游返回 HTTP ${code}` }
    let body = data?.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        return { ok: false, message: '上游响应非 JSON' }
      }
    }
    if (!body || typeof body !== 'object') return { ok: false, message: '上游响应为空' }
    return { ok: true, quota: probe.parse(body) }
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

/** 简单并发池。 */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(lanes)
  return out
}

/** codex / antigravity 等账号的 id_token 或 auth-file → 套餐徽章（类型 + 订阅剩余天数）。 */
function planFromIdToken(file) {
  const token = file?.id_token
  if (token && typeof token === 'object') {
    const type = typeof token.plan_type === 'string' ? token.plan_type : null
    const until = token.chatgpt_subscription_active_until ? Date.parse(token.chatgpt_subscription_active_until) : NaN
    const daysLeft = Number.isNaN(until) ? null : Math.max(0, Math.ceil((until - Date.now()) / 86_400_000))
    if (type || daysLeft !== null) return { type, daysLeft }
  }
  const directPlan = typeof file?.plan === 'string' ? file.plan : typeof file?.tier === 'string' ? file.tier : null
  if (directPlan) return { type: directPlan, daysLeft: null }
  return null
}

// ---------------------------------------------------------------------------
// 插件本体
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const scope = ctx.settings.register(NS, schema)

  // 环境变量首填：仅当用户从未配置过时写入一次。
  if (!normalizeBase(scope.get().baseUrl) && process.env.CPA_BASE_URL) {
    scope.update({ baseUrl: process.env.CPA_BASE_URL }).catch(() => {})
  }

  /** @type {{ at: number, key: string, result: any } | null} */
  let probeCache = null
  /** @type {{ at: number, key: string, result: any } | null} */
  let gatewayCache = null
  /** @type {Map<string, { at: number, data: any }>} authIndex → 配额缓存 */
  const quotaCache = new Map()

  function invalidateCaches() {
    probeCache = null
    gatewayCache = null
    quotaCache.clear()
  }

  async function probeCached(baseUrl, key, force) {
    const cacheKey = `${baseUrl}\n${key}`
    if (!force && probeCache && probeCache.key === cacheKey && Date.now() - probeCache.at < PROBE_CACHE_TTL_MS) {
      return probeCache.result
    }
    const result = await probeAuthFiles(baseUrl, key)
    probeCache = { at: Date.now(), key: cacheKey, result }
    return result
  }

  /** AI 供应商网关（15s 缓存，与 auth-files 同节奏）。 */
  async function gatewaysCached(baseUrl, key, force) {
    const cacheKey = `${baseUrl}\n${key}`
    if (!force && gatewayCache && gatewayCache.key === cacheKey && Date.now() - gatewayCache.at < PROBE_CACHE_TTL_MS) {
      return gatewayCache.result
    }
    const result = await probeGateways(baseUrl, key)
    gatewayCache = { at: Date.now(), key: cacheKey, result }
    return result
  }

  /** 单账号配额（带缓存；并发控制由调用方保证）。 */
  async function quotaForFile(baseUrl, key, file, force) {
    const provider = String(file?.provider ?? file?.type ?? '').toLowerCase()
    const probe = QUOTA_PROBES[provider]
    if (!probe) return { supported: false, windows: [], plan: null, error: null }
    const authIndex = String(file?.auth_index ?? '')
    if (!authIndex) return { supported: true, windows: [], plan: null, error: '缺少 auth_index' }
    const cached = quotaCache.get(authIndex)
    if (!force && cached && Date.now() - cached.at < QUOTA_CACHE_TTL_MS) return cached.data
    const result = await probeQuota(baseUrl, key, authIndex, probe)
    const data = result.ok
      ? { supported: true, windows: result.quota.windows, plan: result.quota.plan, error: null }
      : { supported: true, windows: [], plan: null, error: result.message }
    quotaCache.set(authIndex, { at: Date.now(), data })
    return data
  }

  /** 脱敏配置（GET /config 与 PUT 响应共用）；绝不回传完整密钥。 */
  async function publicConfig() {
    const cfg = scope.get()
    const info = await ctx.credentials.describe(KEY_REF)
    let hint = null
    if (info.configured) {
      const resolved = await ctx.credentials.resolve(KEY_REF).catch(() => undefined)
      hint = resolved?.value ? `••••${resolved.value.slice(-2)}` : '••••'
    }
    return {
      baseUrl: cfg.baseUrl,
      publicUrl: cfg.publicUrl,
      privacyMode: cfg.privacyMode === true,
      managementKey: {
        configured: info.configured,
        source: info.source ?? null,
        writable: info.writable,
        hint,
      },
    }
  }

  /** 当前 DSH 模型路由是否指向 CPA；读不到时降级为 null（不阻塞摘要）。 */
  function routeMatch(baseUrl, publicUrl) {
    try {
      const adm = ctx.get('agentDefaultModel')
      const llm = ctx.get('llm')
      if (!adm || !llm) return null
      const selection = adm.currentSelection()
      if (!selection?.provider) return null
      const entry = llm.listConfigurableProviders().find((p) => p.provider === selection.provider)
      if (!entry) return null
      let profile = ctx.settings.get(/** @type {any} */ (entry.settingsNs))
      for (const key of entry.settingsPath ?? []) profile = profile?.[key]
      if (!profile || typeof profile !== 'object') return null
      const endpoint = ['baseUrl', 'baseURL', 'endpoint', 'apiBase', 'base_url']
        .map((k) => profile[k])
        .find((v) => typeof v === 'string' && v.trim())
      if (!endpoint) return null
      return { matchesCpa: endpointMatchesCpa(endpoint, baseUrl, publicUrl), endpoint: normalizeBase(endpoint) }
    } catch {
      return null
    }
  }

  /** 已配置判定 + 取密钥；未配置时返回缺失清单。 */
  async function requireReady() {
    const cfg = scope.get()
    const baseUrl = normalizeBase(cfg.baseUrl)
    const keyInfo = await ctx.credentials.describe(KEY_REF)
    const missing = []
    if (!baseUrl || !isAbsoluteHttpUrl(baseUrl)) missing.push('baseUrl')
    if (!keyInfo.configured) missing.push('managementKey')
    if (missing.length > 0) return { ready: false, baseUrl, missing }
    const resolved = await ctx.credentials.resolve(KEY_REF)
    if (!resolved?.value) return { ready: false, baseUrl, missing: ['managementKey'] }
    return { ready: true, baseUrl, key: resolved.value, cfg }
  }

  async function buildStatus(force = false) {
    const state = await requireReady()
    const cfg = scope.get()
    const baseUrl = normalizeBase(cfg.baseUrl)
    const keyInfo = await ctx.credentials.describe(KEY_REF)
    const missing = state.ready ? [] : state.missing
    const links = {
      cpaManagement: cfg.publicUrl || (baseUrl ? `${baseUrl}/management.html` : null),
      keeper: null,
    }
    const config = { baseUrl, hasManagementKey: keyInfo.configured, missing }
    if (!state.ready) {
      return {
        ok: false,
        mode: 'needs_config',
        fetchedAt: Date.now(),
        config,
        route: null,
        accounts: null,
        traffic: null,
        issues: [],
        links,
        error: { code: 'NOT_CONFIGURED', message: '需要配置 CPA Base URL 与 Management Key' },
      }
    }
    const probe = await probeCached(state.baseUrl, state.key, force)
    const base = {
      mode: 'ready',
      fetchedAt: Date.now(),
      config,
      route: routeMatch(state.baseUrl, cfg.publicUrl),
      links,
    }
    if (!probe.ok) {
      return {
        ...base,
        ok: false,
        accounts: null,
        traffic: null,
        issues: [],
        error: { code: probe.code, message: probe.message },
      }
    }
    const { accountsOk, accountsTotal, issues } = summarizeAccounts(probe.files)
    return {
      ...base,
      ok: true,
      accounts: { ok: accountsOk, total: accountsTotal },
      traffic: summarizeTraffic(probe.files),
      issues,
      error: null,
    }
  }

  /**
   * 账号明细：auth-files 行（白名单字段）+ 配额。
   * withQuota=false（默认）：只读本地配额缓存，绝不打上游（限额同步是手动操作）；
   * withQuota=true：对过期/缺失的账号触发 api-call 探针（force 时全部重探）。
   */
  async function buildAccounts(force = false, withQuota = false) {
    const state = await requireReady()
    if (!state.ready) {
      return { ok: false, status: 409, error: { code: 'NOT_CONFIGURED', message: '尚未配置 CPA 连接' }, accounts: [] }
    }
    const [probe, gw] = await Promise.all([
      probeCached(state.baseUrl, state.key, force),
      gatewaysCached(state.baseUrl, state.key, force).catch(() => ({ gateways: [], failedTypes: [] })),
    ])
    if (!probe.ok) {
      return { ok: false, status: 200, error: { code: probe.code, message: probe.message }, accounts: [], gateways: [] }
    }
    const rows = await mapPool(probe.files, QUOTA_PROBE_CONCURRENCY, async (f) => {
      const success = f.success | 0
      const failed = f.failed | 0
      const total = success + failed
      const provider = String(f?.provider ?? f?.type ?? '').toLowerCase()
      const idTokenPlan = planFromIdToken(f)

      let quota
      const authIndex = String(f?.auth_index ?? '')
      if (withQuota) {
        const q = await quotaForFile(state.baseUrl, state.key, f, force)
        const entry = authIndex ? quotaCache.get(authIndex) : null
        quota = { ...q, synced: !!q.supported, fetchedAt: entry?.at ?? (q.supported ? Date.now() : null) }
      } else {
        const cached = authIndex ? quotaCache.get(authIndex) : null
        quota = cached
          ? { ...cached.data, synced: true, fetchedAt: cached.at }
          : { supported: !!QUOTA_PROBES[provider], windows: [], plan: null, error: null, synced: false, fetchedAt: null }
      }
      const planType = quota.plan ?? idTokenPlan?.type ?? null

      return {
        id: String(f.name ?? f.id ?? ''),
        label: String(f.label ?? f.account ?? f.name ?? ''),
        provider,
        accountType: String(f.account_type ?? ''),
        status: String(f.status ?? ''),
        statusMessage: String(f.status_message ?? ''),
        disabled: !!f.disabled,
        unavailable: !!f.unavailable,
        requests: { success, failed },
        successRate: total > 0 ? success / total : null,
        recent: summarizeTraffic([f]),
        health: healthFromRecent(f.recent_requests),
        plan: planType ? { type: planType, daysLeft: idTokenPlan?.daysLeft ?? null } : null,
        quota: {
          supported: quota.supported,
          windows: quota.windows,
          error: quota.error,
          synced: quota.synced,
          fetchedAt: quota.fetchedAt,
        },
      }
    })
    return {
      ok: true,
      status: 200,
      fetchedAt: Date.now(),
      accounts: rows,
      gateways: gw.gateways,
      gatewaysError: gw.failedTypes.length ? `部分供应商类型读取失败（${gw.failedTypes.join('、')}）` : null,
    }
  }

  // -------------------------------------------------------------------------
  // HTTP 路由
  // -------------------------------------------------------------------------

  function sendJson(res, status, body) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text.trim()) return {}
    const data = JSON.parse(text)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw Object.assign(new Error('请求体必须是 JSON 对象'), { statusCode: 400 })
    }
    return data
  }

  function guard(handler) {
    return async (req, res) => {
      try {
        await handler(req, res)
      } catch (error) {
        sendJson(res, error?.statusCode ?? 500, {
          error: { code: 'INTERNAL', message: String(error?.message ?? error) },
        })
      }
    }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/cpa-status',
      handler: guard(async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'METHOD', message: 'GET only' } })
        const force = new URL(req.url ?? '/', 'http://localhost').searchParams.has('force')
        sendJson(res, 200, await buildStatus(force))
      }),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/cpa-status/config',
      handler: guard(async (req, res) => {
        if (req.method === 'GET') {
          return sendJson(res, 200, await publicConfig())
        }
        if (req.method !== 'PUT') {
          return sendJson(res, 405, { error: { code: 'METHOD', message: 'GET/PUT only' } })
        }
        const body = await readBody(req)

        // —— 校验 ——
        const baseUrl = normalizeBase(body.baseUrl)
        if (!baseUrl || !isAbsoluteHttpUrl(baseUrl)) {
          return sendJson(res, 400, {
            error: { code: 'INVALID', field: 'baseUrl', message: 'Base URL 必填，且必须是绝对 http(s) 地址' },
          })
        }
        const publicUrl = normalizeBase(body.publicUrl)
        if (publicUrl && !isAbsoluteHttpUrl(publicUrl)) {
          return sendJson(res, 400, {
            error: { code: 'INVALID', field: 'publicUrl', message: 'Public URL 必须是绝对 http(s) 地址' },
          })
        }
        const newKey = typeof body.managementKey === 'string' ? body.managementKey.trim() : ''
        const clearKey = body.clearManagementKey === true
        if (clearKey && newKey) {
          return sendJson(res, 400, {
            error: { code: 'INVALID', field: 'managementKey', message: '不能同时设置新密钥并清除密钥' },
          })
        }

        // —— 写入（密钥可能因只读 env 阴影被拒绝） ——
        try {
          if (clearKey) await ctx.credentials.unset(KEY_REF)
          else if (newKey) await ctx.credentials.set(KEY_REF, newKey)
        } catch (error) {
          return sendJson(res, 409, {
            error: { code: 'KEY_NOT_WRITABLE', message: `密钥写入失败：${error?.message ?? error}` },
          })
        }
        await scope.update({ baseUrl, publicUrl, privacyMode: body.privacyMode === true })

        // —— 保存后探测：失败不回滚，但如实告知（M1 语义） ——
        invalidateCaches()
        const keyInfo = await ctx.credentials.describe(KEY_REF)
        let probe = null
        if (keyInfo.configured) {
          const key = (await ctx.credentials.resolve(KEY_REF))?.value
          probe = key ? await probeAuthFiles(baseUrl, key) : null
        }
        sendJson(res, 200, {
          saved: true,
          config: await publicConfig(),
          probe: probe ? { ok: probe.ok, code: probe.code ?? null, message: probe.message ?? null } : null,
          status: await buildStatus(true),
        })
      }),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/cpa-status/accounts',
      handler: guard(async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'METHOD', message: 'GET only' } })
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams
        const result = await buildAccounts(params.has('force'), params.has('quota'))
        const { status, ...body } = result
        sendJson(res, status ?? 200, body)
      }),
    }),
  )
}
