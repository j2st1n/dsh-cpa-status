/**
 * dsh-cpa-status — Client half (M1.5).
 *
 * 手写 __ModuleLoader__ 包壳（与 tsdown 产物同构），零构建步骤。
 * 槽位：
 *   sidebar.footer.action  常驻紧凑按钮（状态灯 + 短摘要；rail 下仅图标）
 *   shell.overlay          双态面板（needs_config → ConfigCard；ready → StatusCard + 账号明细）
 *
 * 数据全部来自本机 Host API（/api/cpa-status*），密钥永远不会出现在响应里。
 * 提供商图标内联自上游仓库 assets/logo/*.svg（随 CLIProxyAPI 分发）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cpa-status',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    // ---------- 动画与交互样式（注入 <style>，随插件停止移除） ----------
    const CSS = `
      @keyframes cpaFadeSlideUp { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
      @keyframes cpaFadeSlideDown { from { opacity: 1; transform: translateY(0) scale(1) } to { opacity: 0; transform: translateY(10px) scale(.98) } }
      @keyframes cpaFadeIn { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
      @keyframes cpaSpin { to { transform: rotate(360deg) } }
      @keyframes cpaPulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.45) } 70% { box-shadow: 0 0 0 5px rgba(34,197,94,0) } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0) } }
      @keyframes cpaShimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
      .cpa-panel-enter { animation: cpaFadeSlideUp .2s cubic-bezier(.2,.9,.3,1.2) both }
      .cpa-panel-exit { animation: cpaFadeSlideDown .16s ease-in both; pointer-events: none !important }
      .cpa-card { animation: cpaFadeIn .25s ease-out both }
      .cpa-btn { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .1s ease, opacity .15s ease, filter .15s ease }
      .cpa-btn:hover:not(:disabled):not(.cpa-btn-primary) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1)); border-color: var(--dsw-alias-border-l2) }
      .cpa-btn-primary:hover:not(:disabled) { filter: brightness(1.12) }
      .cpa-tab { transition: background .15s ease, color .15s ease }
      .cpa-tab:hover:not(.cpa-tab-active) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)) }
      .cpa-btn:active:not(:disabled) { transform: scale(.96) }
      .cpa-btn:disabled { opacity: .55; cursor: default }
      .cpa-spin { display: inline-block; animation: cpaSpin .8s linear infinite }
      .cpa-dot-live { animation: cpaPulse 2.4s ease-out infinite }
      .cpa-skeleton { border-radius: 8px; background: linear-gradient(90deg, var(--dsw-alias-bg-layer-1) 25%, var(--dsw-alias-border-l1) 50%, var(--dsw-alias-bg-layer-1) 75%); background-size: 200% 100%; animation: cpaShimmer 1.4s linear infinite }
      @media (prefers-reduced-motion: reduce) {
        .cpa-panel-enter, .cpa-panel-exit, .cpa-card, .cpa-spin, .cpa-dot-live, .cpa-skeleton { animation: none !important }
        .cpa-btn { transition: none !important }
      }
    `

    // ---------- 主题变量 ----------
    // 对齐 DSH 设置弹窗的实际用法（读构建产物确认）：弹窗面板 = layer-2（radius 24、shadow-lv3），
    // 内容卡片 = layer-1（深色下比面板暗半档的「内凹井」），卡片内嵌套元素再深半档。
    // overlay token 是小型浮层菜单专用（深色下最亮），大面板不用它。
    const T = {
      bg: 'var(--dsw-alias-bg-layer-2)',
      layer: 'var(--dsw-alias-bg-layer-2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      label: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
    }

    // ---------- 提供商图标（源自 github.com/router-for-me/CLIProxyAPI assets/logo） ----------
    const PROVIDER_ICONS = {
      codex:
        '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>OpenAI</title><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"></path></svg>',
      kimi:
        '<svg width="100%" height="100%" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="180" rx="45" fill="black"/><path d="M139.13 36.5136C144.237 36.5136 148.377 40.6534 148.377 45.7602C148.377 50.8669 144.237 55.0067 139.13 55.0067L130.971 55.0067C130.371 55.0067 129.884 54.5197 129.884 53.9189L129.884 45.7602C129.884 40.6534 134.023 36.5136 139.13 36.5136Z" fill="#1783FF"/><path d="M87.2906 90.3588L122.186 55.7385C122.842 55.0859 122.473 53.7739 121.625 53.7739H102.849C102.645 53.7739 102.447 53.8572 102.288 54.0168L64.6899 91.3099C64.1035 91.8861 63.2367 91.3724 63.2367 90.4491V54.8777C63.2367 54.2668 62.8352 53.7739 62.3444 53.7739H49.406C48.9153 53.7739 48.5137 54.2668 48.5137 54.8777V131.574C48.5137 132.185 48.9153 132.678 49.406 132.678H62.3444C62.8352 132.678 63.2367 132.185 63.2367 131.574V115.947C63.2367 115.614 63.3578 115.295 63.5681 115.087L75.2254 103.521C75.5058 103.243 75.8946 103.202 76.2069 103.41L107.386 126.354C112.492 129.79 118.196 131.9 123.99 132.525C124.506 132.581 124.952 132.067 124.952 131.421V116.704C124.952 116.142 124.614 115.684 124.162 115.614C120.752 115.08 117.425 113.761 114.417 111.734L87.4244 92.1916C86.8636 91.8167 86.7935 90.8517 87.2906 90.3588Z" fill="white"/></svg>',
      xai:
        '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>Grok</title><path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"></path></svg>',
      claude:
        '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>Claude</title><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"></path></svg>',
    }
    /** currentColor 图标的着色；kimi 图标自带品牌底色，走 null 不上色。 */
    const PROVIDER_ICON_COLOR = { codex: '#10a37f', xai: 'var(--dsw-alias-label-primary)', claude: '#d97757', kimi: null }
    const providerColor = (p) =>
      ({ codex: '#10a37f', kimi: '#7c5cff', xai: '#e5484d', claude: '#d97757', gemini: '#4285f4' })[p] ?? T.brand

    /** 供应商类型显示名（auth-files 的 provider/type 字段）。 */
    const PROVIDER_NAME = { codex: 'Codex', kimi: 'Kimi', xai: 'xAI', claude: 'Claude', gemini: 'Gemini', antigravity: 'Antigravity' }

    /** AI 供应商网关类型 → 显示名与图标 key（复用提供商图标，未知走首字母兜底）。 */
    const GATEWAY_NAME = {
      'gemini-api-key': 'Gemini',
      'claude-api-key': 'Claude',
      'codex-api-key': 'Codex',
      'xai-api-key': 'xAI',
      'openai-compatibility': 'OpenAI 兼容',
      'vertex-api-key': 'Vertex',
      'interactions-api-key': 'Interactions',
    }
    const GATEWAY_PROVIDER = {
      'gemini-api-key': 'gemini',
      'claude-api-key': 'claude',
      'codex-api-key': 'codex',
      'xai-api-key': 'xai',
      'openai-compatibility': 'codex',
      'vertex-api-key': 'vertex',
      'interactions-api-key': 'interactions',
    }

    /** 供应商类型标签（tooltip 附认证方式/来源）。 */
    function ProviderTag(props) {
      const p = String(props.provider ?? '').toLowerCase()
      if (!p) return null
      const meta = [props.accountType ? `认证方式 ${props.accountType}` : null].filter(Boolean).join(' · ')
      return h(
        'span',
        {
          style: {
            fontSize: 10,
            color: providerColor(p),
            border: `1px solid ${providerColor(p)}`,
            borderRadius: 4,
            padding: '0 4px',
            flexShrink: 0,
            lineHeight: '14px',
            opacity: 0.9,
          },
          title: meta || undefined,
        },
        PROVIDER_NAME[p] ?? p,
      )
    }

    function ProviderIcon(props) {
      const p = String(props.provider ?? '').toLowerCase()
      const svg = PROVIDER_ICONS[p]
      if (svg) {
        return h('span', {
          style: {
            display: 'inline-flex',
            width: 18,
            height: 18,
            fontSize: 18,
            lineHeight: 1,
            borderRadius: p === 'kimi' ? 4 : 0,
            overflow: 'hidden',
            flexShrink: 0,
            color: PROVIDER_ICON_COLOR[p] ?? undefined,
          },
          dangerouslySetInnerHTML: { __html: svg },
        })
      }
      // 未知 provider：首字母色块兜底
      return h(
        'span',
        {
          style: {
            width: 18,
            height: 18,
            borderRadius: 5,
            background: providerColor(p),
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            textTransform: 'uppercase',
          },
        },
        (p || '?')[0],
      )
    }

    // ---------- 套餐分级样式 ----------
    /** 套餐类型 → 徽章样式：free 灰描边 / plus·intermediate 品牌蓝 / pro 紫蓝渐变 / team+ 金渐变 / 其他品牌描边。 */
    function planBadgeStyle(type) {
      const t = String(type ?? '').toLowerCase()
      if (!t) return null
      const base = { fontSize: 10, borderRadius: 4, padding: '1px 6px', flexShrink: 0, fontWeight: 600, letterSpacing: 0.3 }
      if (t === 'free') return { ...base, color: T.secondary, background: 'transparent', border: `1px solid ${T.border}` }
      if (['plus', 'intermediate', 'basic', 'standard'].includes(t))
        return { ...base, color: '#fff', background: T.brand, border: `1px solid ${T.brand}` }
      if (['pro', 'professional', 'advanced'].includes(t))
        return { ...base, color: '#fff', background: 'linear-gradient(135deg,#7c5cff,#3d7bfd)', border: '1px solid transparent' }
      if (['team', 'business', 'enterprise', 'max', 'ultra', 'unlimited'].includes(t))
        return { ...base, color: '#1a1a1a', background: 'linear-gradient(135deg,#f6d365,#e8a33d)', border: '1px solid transparent' }
      return { ...base, color: T.brand, background: 'transparent', border: `1px solid ${T.brand}` }
    }

    function PlanBadge(props) {
      const plan = props.plan
      const style = planBadgeStyle(plan?.type)
      if (!style) return null
      const text = [String(plan.type).toUpperCase(), plan.daysLeft !== null && plan.daysLeft !== undefined ? `${plan.daysLeft}d` : null]
        .filter(Boolean)
        .join(' · ')
      return h('span', { style, title: plan.daysLeft != null ? `订阅剩余 ${plan.daysLeft} 天` : undefined }, text)
    }

    // ---------- 模块级 store ----------
    const store = {
      state: {
        open: false,
        editing: false,
        status: null,
        config: null,
        unreachableApi: null,
        accounts: null,
        accountsError: null,
        accountsLoading: false,
        quotaSyncing: false,
        refreshing: false,
        gateways: null,
        gatewaysError: null,
        tab: null, // null = 自动（两类并存时默认认证文件页）
        privacy: false, // 脱敏模式：显示层打码，由 config.privacyMode 回填
      },
      listeners: new Set(),
      set(patch) {
        store.state = { ...store.state, ...patch }
        for (const fn of store.listeners) fn()
      },
      subscribe(fn) {
        store.listeners.add(fn)
        return () => store.listeners.delete(fn)
      },
    }
    function useStore() {
      return React.useSyncExternalStore(store.subscribe, () => store.state)
    }

    // ---------- 本机 API ----------
    async function api(path, options) {
      const res = await fetch(path, options)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), { data })
      return data
    }
    async function refreshStatus(force) {
      try {
        const status = await api(`/api/cpa-status${force ? '?force=1' : ''}`)
        store.set({ status, unreachableApi: null })
      } catch (error) {
        store.set({ unreachableApi: String(error?.message ?? error) })
      }
    }
    async function refreshConfig() {
      try {
        const config = await api('/api/cpa-status/config')
        store.set({ config, privacy: config?.privacyMode === true })
      } catch {
        /* 回填留空即可 */
      }
    }
    /** 脱敏模式开关：立即生效（显示层），并异步持久化到设置（带上现有地址字段满足 PUT 校验）。 */
    function togglePrivacy() {
      const privacy = !store.state.privacy
      store.set({ privacy })
      const cfg = store.state.config ?? {}
      api('/api/cpa-status/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: cfg.baseUrl ?? '', publicUrl: cfg.publicUrl ?? '', privacyMode: privacy }),
      })
        .then((res) => {
          if (res?.config) store.set({ config: res.config })
        })
        .catch(() => {
          /* 持久化失败不影响本次显示 */
        })
    }
    async function refreshAccounts(force, withQuota) {
      const st = store.state.status
      if (st?.mode !== 'ready' || !st.ok) return
      if (!store.state.accounts) store.set({ accountsLoading: true })
      try {
        const qs = [force ? 'force=1' : '', withQuota ? 'quota=1' : ''].filter(Boolean).join('&')
        const data = await api(`/api/cpa-status/accounts${qs ? `?${qs}` : ''}`)
        store.set({
          accounts: data.accounts ?? [],
          accountsError: data.error?.message ?? null,
          accountsLoading: false,
          gateways: data.gateways ?? [],
          gatewaysError: data.gatewaysError ?? null,
        })
      } catch (error) {
        store.set({ accountsError: String(error?.message ?? error), accountsLoading: false })
      }
    }
    /** 手动同步配额：唯一触发上游 api-call 探针的入口。 */
    async function syncQuota() {
      if (store.state.quotaSyncing) return
      store.set({ quotaSyncing: true })
      try {
        await refreshAccounts(true, true)
      } finally {
        store.set({ quotaSyncing: false })
      }
    }
    function openOverlay() {
      store.set({ open: true, editing: false })
      refreshStatus(false).then(() => refreshAccounts(false, false))
      refreshConfig()
    }
    function toggleOverlay() {
      if (store.state.open) {
        store.set({ open: false, editing: false })
        return
      }
      openOverlay()
    }
    async function refreshAll() {
      if (store.state.refreshing) return
      store.set({ refreshing: true })
      try {
        // 刷新只打 auth-files，不碰上游配额探针——限额同步只能手动（syncQuota）
        await refreshStatus(true)
        await refreshAccounts(true, false)
      } finally {
        store.set({ refreshing: false })
      }
    }

    // ---------- 格式化 ----------
    function fmtNum(n) {
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
      if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
      return String(n)
    }
    function fmtPct(rate) {
      if (rate === null || rate === undefined) return '—'
      const pct = rate * 100
      return `${pct >= 99.95 ? Math.round(pct) : pct.toFixed(1)}%`
    }
    function fmtReset(resetAt) {
      if (!resetAt) return ''
      const ms = resetAt - Date.now()
      if (ms <= 0) return '已到期'
      const m = Math.floor(ms / 60000)
      if (m < 60) return `${m}m`
      const hh = Math.floor(m / 60)
      if (hh < 48) return `${hh}h${m % 60 ? `${m % 60}m` : ''}`
      const d = Math.floor(hh / 24)
      return `${d}d${hh % 24 ? `${hh % 24}h` : ''}`
    }
    function hostOf(url) {
      try {
        return new URL(url).host
      } catch {
        return url
      }
    }

    // ---------- 脱敏（显示层打码；数据原样保留，开关即时切换） ----------
    const isPrivacy = () => store.state.privacy === true
    /** 邮箱：首字符 + ***@***.tld */
    function maskEmail(v) {
      if (!isPrivacy() || !v) return v
      const at = v.indexOf('@')
      if (at < 1) return maskName(v)
      const dot = v.lastIndexOf('.')
      const tld = dot > at ? v.slice(dot) : ''
      return `${v[0]}***@***${tld}`
    }
    /** 名称：保留类型段或前两字（codex-y2f9 → codex-***；百炼TokenPlan → 百炼***） */
    function maskName(v) {
      if (!isPrivacy() || !v) return v
      const sep = v.search(/[-_]/)
      if (sep > 0) return `${v.slice(0, sep)}-***`
      return `${v.slice(0, 2)}***`
    }
    /** 账号标签：含 @ 走邮箱规则，否则走名称规则 */
    function maskLabel(v) {
      if (!isPrivacy() || !v) return v
      return v.includes('@') ? maskEmail(v) : maskName(v)
    }
    /** 主机名 / URL 展示：首字符 + *** */
    function maskHost(v) {
      if (!isPrivacy() || !v) return v
      return `${v[0]}***`
    }
    /** 密钥提示：字母数字全部打码（••••ab12 → ••••••••） */
    function maskHint(v) {
      if (!isPrivacy() || !v) return v
      return v.replace(/[A-Za-z0-9]/g, '•')
    }
    /** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前。 */
    function fmtAgo(ts) {
      if (!ts) return ''
      const s = Math.floor((Date.now() - ts) / 1000)
      if (s < 60) return '刚刚'
      const m = Math.floor(s / 60)
      if (m < 60) return `${m} 分钟前`
      const hh = Math.floor(m / 60)
      if (hh < 48) return `${hh} 小时前`
      return `${Math.floor(hh / 24)} 天前`
    }
    /** 成功率分档着色：≥99 绿 / ≥95 黄 / 其余红；无数据用次要色。 */
    function rateColor(rate) {
      if (rate === null || rate === undefined) return T.secondary
      const pct = rate * 100
      return pct >= 99 ? T.ok : pct >= 95 ? T.warn : T.err
    }

    // ---------- 样式片段 ----------
    const dotStyle = (color) => ({
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    })
    const btnBase = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      background: 'transparent',
      color: T.label,
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      background: T.layer1,
      color: T.label,
      fontSize: 12,
      outline: 'none',
    }
    const labelStyle = { display: 'block', fontSize: 12, color: T.secondary, marginBottom: 4 }

    // ---------- 常驻入口 ----------
    function FooterEntry(props) {
      const state = useStore()
      useEffect(() => {
        refreshStatus(false)
        const timer = setInterval(() => refreshStatus(false), 20_000)
        return () => clearInterval(timer)
      }, [])
      const st = state.status
      let color = T.warn
      let text = '连接 CPA'
      let segments = null // 分段富文本：[{ text, color }]，就绪态替代纯 text
      let title = '配置 CPA 连接'
      if (state.unreachableApi) {
        color = T.err
        text = 'CPA ?'
        title = `本机状态 API 异常：${state.unreachableApi}`
      } else if (st?.mode === 'ready') {
        if (st.ok) {
          color = T.ok
          // 渐进披露：常态只给「账号在线数 + 30 分钟流量」；成功率仅在 < 99% 时出现并着色，
          // 账号缺员时计数变警告色——健康时不刷存在感，异常时一眼定位。
          segments = [{ text: 'CPA', color: T.label }]
          if (st.accounts) {
            const { ok, total } = st.accounts
            segments.push({ text: `${ok}/${total} 账号`, color: ok === total ? T.label : T.warn })
          }
          const tr = st.traffic
          if (tr) {
            if (tr.requests === 0) {
              segments.push({ text: '空闲', color: T.secondary })
            } else if (tr.successRate !== null && tr.successRate !== undefined && tr.successRate < 0.99) {
              segments.push({ text: `成功率 ${fmtPct(tr.successRate)}`, color: rateColor(tr.successRate) })
            } else {
              segments.push({ text: `${tr.requests} 次/30min`, color: T.label })
            }
          }
          title = tr
            ? `CPA 在线 · 近 30 分钟 ${tr.requests} 次请求，成功率 ${fmtPct(tr.successRate)} · 点击查看详情`
            : 'CPA 在线，点击查看详情'
        } else {
          color = T.err
          text = 'CPA 异常'
          title = st.error?.message ?? 'CPA 异常'
        }
      }
      const labelEl =
        props?.wide === false
          ? null
          : segments
            ? h(
                'span',
                { style: { display: 'inline-flex', alignItems: 'baseline', whiteSpace: 'nowrap' } },
                segments.flatMap((s, i) =>
                  i === 0
                    ? [h('span', { key: `s${i}`, style: { color: s.color } }, s.text)]
                    : [
                        h('span', { key: `sep${i}`, style: { color: T.secondary, margin: '0 5px', opacity: 0.7 } }, '·'),
                        h('span', { key: `s${i}`, style: { color: s.color, fontVariantNumeric: 'tabular-nums' } }, s.text),
                      ],
                ),
              )
            : h('span', null, text)
      return h(
        'button',
        { className: 'cpa-btn', style: btnBase, onClick: toggleOverlay, title },
        h('span', { className: color === T.ok ? 'cpa-dot-live' : undefined, style: dotStyle(color) }),
        labelEl,
      )
    }

    // ---------- 配额进度条 ----------
    function QuotaBar(props) {
      const pct = props.window.remainingPct
      const color = pct === null ? T.secondary : pct > 50 ? T.ok : pct > 20 ? T.warn : T.err
      return h('div', { style: { marginTop: 6 } }, [
        h('div', { key: 'meta', style: { display: 'flex', fontSize: 11, marginBottom: 3, fontVariantNumeric: 'tabular-nums' } }, [
          h('span', { style: { color: T.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.window.label),
          h('span', { style: { marginLeft: 'auto', color, fontWeight: 600 } }, pct === null ? '—' : `${pct}%`),
          props.window.resetAt
            ? h('span', { style: { color: T.secondary, marginLeft: 6 } }, `↻ ${fmtReset(props.window.resetAt)}`)
            : null,
        ]),
        // 轨道始终渲染：用状态色 14% 淡染（color-mix，深浅主题自适应）+ 发丝内描边；
        // 无数据（pct=null）时显示空染轨道而非一片空白。
        h(
          'div',
          {
            key: 'bar',
            style: {
              height: 6,
              borderRadius: 3,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              boxShadow: `inset 0 0 0 1px ${T.border}`,
              overflow: 'hidden',
            },
          },
          pct === null
            ? null
            : h('div', { style: { height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' } }),
        ),
      ])
    }

    // ---------- 指标宫格（只渲染真实可得的指标） ----------
    function MetricGrid(props) {
      const cells = [
        { label: '请求总数', value: props.requests != null ? fmtNum(props.requests) : '—', title: props.requestsTitle },
        { label: '成功率', value: fmtPct(props.successRate), color: props.successRate != null ? rateColor(props.successRate) : undefined },
        {
          label: '近 30 分钟',
          value: props.recent != null ? fmtNum(props.recent.requests) : '—',
          title: props.recent ? `近 30 分钟请求 ${props.recent.requests} 次，成功率 ${fmtPct(props.recent.successRate)}` : undefined,
        },
      ]
      return h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, margin: '6px 0' } },
        cells.map((c) =>
          h('div', { key: c.label, title: c.title, style: { background: T.layer, borderRadius: 6, padding: '5px 8px', minWidth: 0 } }, [
            h('div', { key: 'v', style: { fontSize: 13, fontWeight: 600, lineHeight: '17px', color: c.color ?? (c.value === '—' ? T.secondary : T.label), fontVariantNumeric: 'tabular-nums' } }, c.value),
            h('div', { key: 'l', style: { fontSize: 10, color: T.secondary, marginTop: 1 } }, c.label),
          ]),
        ),
      )
    }

    // ---------- 健康刻度带 ----------
    // 每 10 分钟桶一根刻度：绿=全成功，红=有失败，灰=无流量；右侧窗口成功率。
    function HealthStrip(props) {
      const health = props.health
      if (!health || !health.buckets?.length) {
        return h('div', { style: { display: 'flex', fontSize: 11, color: T.secondary, margin: '6px 0 2px' } }, [
          h('span', { style: { fontWeight: 600 } }, '健康'),
          h('span', { style: { marginLeft: 'auto' } }, '暂无流量数据'),
        ])
      }
      return h('div', { style: { margin: '6px 0 2px' } }, [
        h('div', { key: 'hd', style: { display: 'flex', alignItems: 'baseline', fontSize: 11, marginBottom: 4 } }, [
          h('span', { style: { color: T.secondary, fontWeight: 600 } }, '健康'),
          h('span', { style: { marginLeft: 'auto', color: T.secondary, fontVariantNumeric: 'tabular-nums' } }, `最近 ${health.spanText}`),
          h('span', {
            style: { marginLeft: 8, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: health.successRate != null ? rateColor(health.successRate) : T.secondary },
          }, health.successRate != null ? fmtPct(health.successRate) : '—'),
        ]),
        h('div', { key: 'tk', style: { display: 'flex', gap: 2 } },
          health.buckets.map((b, i) => {
            const total = b.ok + b.failed
            const bg = total === 0
              ? 'color-mix(in srgb, var(--dsw-alias-label-secondary) 16%, transparent)'
              : b.failed > 0 ? T.err : T.ok
            return h('div', { key: i, title: `${b.time || '该时段'} · 成功 ${b.ok} / 失败 ${b.failed}`, style: { flex: 1, height: 5, borderRadius: 2, background: bg } })
          }),
        ),
      ])
    }

    // ---------- 单账号卡片 ----------
    function AccountCard(props) {
      const a = props.account
      const stateColor = a.disabled ? T.secondary : a.unavailable ? T.err : T.ok
      const stateText = a.disabled ? '已停用' : a.unavailable ? '不可用' : a.status === 'active' ? '运行中' : a.status || '未知'
      const req = a.requests
      return h(
        'div',
        {
          className: 'cpa-card',
          style: {
            background: T.layer1,
            border: `1px solid ${T.border2}`,
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 8,
            opacity: a.disabled ? 0.55 : 1,
            animationDelay: `${(props.index ?? 0) * 45}ms`,
          },
        },
        [
          // 标题行：真实提供商图标 + 名称 + 供应商类型标签 + 套餐徽章 + 状态
          h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 } }, [
            h(ProviderIcon, { provider: a.provider }),
            h('span', { style: { fontSize: 12, color: T.label, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: maskLabel(a.label) }, maskLabel(a.label) || a.id),
            h(ProviderTag, { provider: a.provider, accountType: a.accountType }),
            h(PlanBadge, { plan: a.plan }),
            h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } }, [
              h('span', { style: dotStyle(stateColor) }),
              h('span', { style: { fontSize: 11, color: stateColor } }, stateText),
            ]),
          ]),
          // 指标宫格（请求总数 / 成功率 / 近 30 分钟）+ 健康刻度带
          h(MetricGrid, {
            key: 'mg',
            requests: req.success + req.failed,
            requestsTitle: `lifetime 成功 ${fmtNum(req.success)} / 失败 ${fmtNum(req.failed)}`,
            successRate: a.successRate,
            recent: a.recent,
          }),
          h(HealthStrip, { key: 'hs', health: a.health }),
          a.statusMessage && a.status !== 'active'
            ? h('div', { key: 'msg', style: { fontSize: 11, color: T.warn, marginTop: 4 } }, a.statusMessage)
            : null,
          // 配额窗口（手动同步制：未同步给提示；已同步给进度条 + 上次同步时间）
          a.quota?.supported
            ? !a.quota.synced
              ? h(
                  'div',
                  {
                    key: 'qp',
                    style: { fontSize: 11, color: T.secondary, marginTop: 6, border: `1px dashed ${T.border2}`, borderRadius: 6, padding: '7px 8px', textAlign: 'center' },
                  },
                  '限额未同步 · 点击底部「同步配额」获取',
                )
              : h(
                  'div',
                  { key: 'q', style: { marginTop: 2 } },
                  [
                    ...(a.quota.windows ?? []).map((w, i) => h(QuotaBar, { key: `${w.label}-${i}`, window: w })),
                    a.quota.error
                      ? h('div', { key: 'qe', style: { fontSize: 11, color: T.err, marginTop: 6 } }, `配额获取失败：${a.quota.error}`)
                      : null,
                    !a.quota.error && !(a.quota.windows ?? []).length
                      ? h('div', { key: 'qn', style: { fontSize: 11, color: T.secondary, marginTop: 6 } }, '暂无配额数据')
                      : null,
                    h('div', { key: 'qt', style: { fontSize: 10, color: T.secondary, marginTop: 5, textAlign: 'right' } }, `限额同步于 ${fmtAgo(a.quota.fetchedAt)}`),
                  ].filter(Boolean),
                )
            : null,
        ],
      )
    }

    // ---------- AI 供应商网关行 ----------
    function GatewayRow(props) {
      const g = props.gateway
      const pkey = GATEWAY_PROVIDER[g.type] ?? ''
      const title = g.name || GATEWAY_NAME[g.type] || g.type
      const typeTag = g.name ? (GATEWAY_NAME[g.type] ?? g.type) : null // 有自定义名时再补类型标签
      return h(
        'div',
        {
          className: 'cpa-card',
          style: {
            background: T.layer1,
            border: `1px solid ${T.border2}`,
            borderRadius: 8,
            padding: '7px 10px',
            marginBottom: 8,
            opacity: g.disabled ? 0.55 : 1,
            animationDelay: `${(props.index ?? 0) * 45}ms`,
          },
        },
        [
          h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h(ProviderIcon, { provider: pkey }),
            h('span', { style: { fontSize: 12, color: T.label, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: maskName(title) }, maskName(title)),
            typeTag
              ? h('span', { style: { fontSize: 10, color: providerColor(pkey), border: `1px solid ${providerColor(pkey)}`, borderRadius: 4, padding: '0 4px', flexShrink: 0, lineHeight: '14px', opacity: 0.9 } }, typeTag)
              : null,
            g.models.length ? h('span', { style: { fontSize: 10, color: T.secondary, flexShrink: 0 } }, `${g.models.length} 模型`) : null,
            h('span', { key: 'st', style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } }, [
              h('span', { style: dotStyle(g.disabled ? T.secondary : T.ok) }),
              h('span', { style: { fontSize: 11, color: g.disabled ? T.secondary : T.ok } }, g.disabled ? '已停用' : '启用'),
            ]),
          ].filter(Boolean)),
          h('div', { key: 'sub', style: { display: 'flex', fontSize: 11, color: T.secondary, gap: 10, flexWrap: 'wrap', marginTop: 3 } }, [
            g.baseUrl ? h('span', { key: 'u', title: maskHost(g.baseUrl), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 } }, maskHost(hostOf(g.baseUrl))) : null,
            g.keys.length ? h('span', { key: 'k' }, `密钥 ${g.keys.map((k) => maskHint(k.hint)).join('、')}`) : null,
            g.models.length
              ? h('span', { key: 'm', title: g.models.map((m) => (m.alias ? `${m.name} → ${m.alias}` : m.name)).join('、') },
                  `模型 ${g.models.slice(0, 3).map((m) => m.alias || m.name).join('、')}${g.models.length > 3 ? ` 等${g.models.length}个` : ''}`)
              : null,
          ].filter(Boolean)),
        ],
      )
    }

    /** 区块标题。 */
    function SectionTitle(props) {
      return h('div', { style: { fontSize: 11, fontWeight: 600, color: T.secondary, margin: '10px 0 6px', letterSpacing: 0.4 } }, props.text)
    }

    /** 列表模式：两类并存 → Tab 切换；否则平铺；仅供应商时默认落供应商页。 */
    function listMode(state) {
      const accounts = state.accounts ?? []
      const gateways = state.gateways ?? []
      const bothTypes = accounts.length > 0 && gateways.length > 0
      const activeTab = bothTypes
        ? state.tab ?? 'accounts'
        : accounts.length === 0 && gateways.length > 0
          ? 'gateways'
          : 'accounts'
      return { accounts, gateways, bothTypes, activeTab }
    }

    // ---------- 分段选择器（认证文件 / AI 供应商） ----------
    // 轨道 = layer-1 内凹，激活 thumb = layer-2（与面板同面，微阴影浮起）——对齐 DSH 分段控件质感。
    function SegmentedTabs(props) {
      const tabBtn = (id, label, count) => {
        const active = props.active === id
        return h(
          'button',
          {
            className: active ? 'cpa-tab cpa-tab-active' : 'cpa-tab',
            style: {
              ...btnBase,
              flex: 1,
              justifyContent: 'center',
              border: 'none',
              padding: '5px 0',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? T.label : T.secondary,
              fontVariantNumeric: 'tabular-nums',
              ...(active ? { background: T.bg, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' } : {}),
            },
            onClick: () => store.set({ tab: id }),
          },
          `${label} · ${count}`,
        )
      }
      return h('div', { style: { display: 'flex', gap: 2, padding: 2, background: T.layer1, borderRadius: 8 } }, [
        tabBtn('accounts', '认证文件', props.accounts),
        tabBtn('gateways', 'AI 供应商', props.gateways),
      ])
    }

    // ---------- 固定信息区（概要 chips + 异常提示 + 分段选择器，不随列表滚动） ----------
    function PanelInfo() {
      const state = useStore()
      const st = state.status
      const trafficPct = st?.traffic ? fmtPct(st.traffic.successRate) : null
      const chips = [
        st?.traffic ? chip(`30min ${st.traffic.requests} 请求`) : null,
        trafficPct ? chip(`成功率 ${trafficPct}`, rateColor(st.traffic.successRate)) : null,
        st?.route ? chip(st.route.matchesCpa ? '路由经 CPA' : '路由未经 CPA', st.route.matchesCpa ? T.ok : T.secondary) : null,
      ].filter(Boolean)
      const { accounts, gateways, bothTypes, activeTab } = listMode(state)
      const issues = st?.issues?.length
        ? `异常账号 ${st.issues.length} 个（${maskName(st.issues[0].id)}${st.issues.length > 1 ? ' 等' : ''}）`
        : null
      return h('div', { style: { flexShrink: 0, padding: '10px 16px', borderBottom: `1px solid ${T.border}` } }, [
        chips.length
          ? h('div', { key: 'chips', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: bothTypes || issues ? 8 : 0 } }, chips)
          : null,
        issues ? h('div', { key: 'iss', style: { fontSize: 11, color: T.warn, marginBottom: bothTypes ? 8 : 0 } }, issues) : null,
        bothTypes ? h(SegmentedTabs, { key: 'tabs', active: activeTab, accounts: accounts.length, gateways: gateways.length }) : null,
      ].filter(Boolean))
    }

    // ---------- 状态卡 ----------
    function StatusCard() {
      const state = useStore()
      const st = state.status
      useEffect(() => {
        if (st?.mode === 'ready' && st.ok && !state.accounts && !state.accountsLoading) refreshAccounts(false)
      }, [st?.fetchedAt])
      if (!st) return h('div', { style: { fontSize: 12, color: T.secondary } }, '加载中…')

      if (!st.ok) {
        return h('div', null, [
          h('div', { key: 'e', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } }, [
            h('span', { style: dotStyle(T.err) }),
            h('span', { style: { fontSize: 13, color: T.label } }, st.error?.message ?? 'CPA 异常'),
          ]),
          h('div', { key: 'b', style: { display: 'flex', gap: 8 } }, [
            h('button', { className: 'cpa-btn cpa-btn-primary', style: { ...btnBase, background: T.brand, borderColor: T.brand, color: '#fff' }, onClick: () => { store.set({ editing: true }); refreshConfig() } }, '更新配置'),
            h('button', { className: 'cpa-btn', style: btnBase, onClick: () => refreshStatus(true) }, '重试'),
          ]),
        ])
      }

      // 列表区：加载骨架 / 错误 / 按 Tab 出列表；chips、异常提示与分段选择器在固定区（PanelInfo）
      const { accounts, gateways, bothTypes, activeTab } = listMode(state)
      if (state.accountsLoading && !state.accounts) {
        return h('div', null, [
          h('div', { key: 's1', className: 'cpa-skeleton', style: { height: 150, marginBottom: 8 } }),
          h('div', { key: 's2', className: 'cpa-skeleton', style: { height: 150, marginBottom: 8, opacity: 0.7 } }),
        ])
      }
      if (state.accountsError) {
        return h('div', { style: { fontSize: 12, color: T.err, padding: '8px 0' } }, state.accountsError)
      }
      const accountList = accounts.map((a, i) => h(AccountCard, { key: a.id, account: a, index: i }))
      const gatewayList = [
        state.gatewaysError ? h('div', { key: 'gwe', style: { fontSize: 11, color: T.warn, marginBottom: 6 } }, state.gatewaysError) : null,
        ...gateways.map((g, i) => h(GatewayRow, { key: `${g.type}-${g.name ?? i}`, gateway: g, index: i })),
      ].filter(Boolean)
      if (bothTypes) {
        // key 按 Tab 区分 → 切换时整列重挂载触发渐入过渡；面板高度固定，不抖动
        return activeTab === 'accounts' ? h('div', { key: 'la' }, accountList) : h('div', { key: 'lg' }, gatewayList)
      }
      return h(
        'div',
        null,
        [
          ...accountList,
          gateways.length > 0 || state.gatewaysError
            ? [h(SectionTitle, { key: 'th2', text: `AI 供应商 · ${gateways.length}` }), ...gatewayList]
            : null,
        ].flat().filter(Boolean),
      )
    }

    function chip(text, color) {
      return h(
        'span',
        {
          style: {
            fontSize: 11,
            color: color ?? T.label,
            background: T.layer1,
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            padding: '2px 7px',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          },
        },
        text,
      )
    }

    // ---------- 配置表单 ----------
    function ConfigCard() {
      const state = useStore()
      const cfg = state.config
      const keyState = cfg?.managementKey ?? { configured: false, writable: true, hint: null }
      const [baseUrl, setBaseUrl] = useState('')
      const [publicUrl, setPublicUrl] = useState('')
      const [managementKey, setManagementKey] = useState('')
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      const [probeError, setProbeError] = useState(null)

      useEffect(() => {
        if (cfg) {
          setBaseUrl(cfg.baseUrl ?? '')
          setPublicUrl(cfg.publicUrl ?? '')
        }
      }, [cfg])

      async function save() {
        setSaving(true)
        setError(null)
        setProbeError(null)
        try {
          const result = await api('/api/cpa-status/config', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ baseUrl, publicUrl, privacyMode: state.privacy, ...(managementKey ? { managementKey } : {}) }),
          })
          store.set({ status: result.status, config: result.config, accounts: null })
          setManagementKey('')
          if (result.probe && !result.probe.ok) {
            setProbeError(result.probe.message ?? result.probe.code ?? '探测失败')
          } else if (result.status?.mode === 'ready') {
            store.set({ editing: false })
            // 配置已变更（服务端缓存全清），重拉账号但不自动探配额
            refreshAccounts(false, false)
          }
        } catch (e) {
          setError(e?.message ?? '保存失败')
        } finally {
          setSaving(false)
        }
      }

      async function clearSecret() {
        if (!window.confirm('确定清除已保存的 Management Key？清除后将回到未配置状态。')) return
        setSaving(true)
        setError(null)
        try {
          const result = await api('/api/cpa-status/config', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ baseUrl: baseUrl || cfg?.baseUrl || '', privacyMode: state.privacy, clearManagementKey: true }),
          })
          store.set({ status: result.status, config: result.config, editing: false, accounts: null })
        } catch (e) {
          setError(e?.message ?? '清除失败')
        } finally {
          setSaving(false)
        }
      }

      return h('div', null, [
        h('div', { key: 'u', style: { marginBottom: 10 } }, [
          h('label', { style: labelStyle }, 'Base URL *'),
          h('input', {
            style: inputStyle,
            type: state.privacy ? 'password' : undefined, // 脱敏时以密码框样式打码，值不受影响
            value: baseUrl,
            placeholder: 'https://your-cpa.example.com 或 http://127.0.0.1:8317',
            onChange: (e) => setBaseUrl(e.target.value),
          }),
        ]),
        h('div', { key: 'k', style: { marginBottom: 10 } }, [
          h('label', { style: labelStyle }, `Management Key *${keyState.configured ? `（已保存 ${maskHint(keyState.hint) ?? ''}）` : ''}`),
          h('input', {
            style: { ...inputStyle, opacity: keyState.writable ? 1 : 0.6 },
            type: 'password',
            value: managementKey,
            disabled: !keyState.writable,
            placeholder: keyState.configured ? '留空表示不修改' : '粘贴 Management Key',
            onChange: (e) => setManagementKey(e.target.value),
          }),
          !keyState.writable
            ? h('div', { style: { fontSize: 11, color: T.warn, marginTop: 4 } }, '密钥由环境变量注入（只读），表单内不可修改')
            : null,
        ]),
        h('div', { key: 'p', style: { marginBottom: 12 } }, [
          h('label', { style: labelStyle }, 'Public URL（可选，「管理页」外链）'),
          h('input', {
            style: inputStyle,
            type: state.privacy ? 'password' : undefined,
            value: publicUrl,
            placeholder: '默认 {Base URL}/management.html',
            onChange: (e) => setPublicUrl(e.target.value),
          }),
        ]),
        error ? h('div', { key: 'e', style: { fontSize: 12, color: T.err, marginBottom: 8 } }, error) : null,
        probeError
          ? h('div', { key: 'pe', style: { fontSize: 12, color: T.warn, marginBottom: 8 } }, `已保存，但连接探测失败：${probeError}`)
          : null,
        h('div', { key: 'b', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
          h(
            'button',
            { className: 'cpa-btn cpa-btn-primary', style: { ...btnBase, background: T.brand, borderColor: T.brand, color: '#fff' }, disabled: saving, onClick: save },
            saving ? h('span', { className: 'cpa-spin' }, '↻') : null,
            saving ? '保存中…' : '保存并连接',
          ),
          state.status?.mode === 'ready'
            ? h('button', { className: 'cpa-btn', style: btnBase, disabled: saving, onClick: () => store.set({ editing: false }) }, '取消')
            : null,
          keyState.configured && keyState.writable
            ? h('button', { className: 'cpa-btn', style: { ...btnBase, color: T.err, marginLeft: 'auto' }, disabled: saving, onClick: clearSecret }, '清除密钥')
            : null,
        ]),
      ])
    }

    // ---------- 固定底部操作条 ----------
    // 限额同步是唯一触发上游探针的手动入口；刷新只打 auth-files，不碰配额。
    function OpsBar() {
      const state = useStore()
      const st = state.status
      return h('div', { style: { flexShrink: 0, borderTop: `1px solid ${T.border}`, padding: '10px 16px 12px', display: 'flex', gap: 8 } }, [
        h(
          'button',
          { className: 'cpa-btn', style: btnBase, disabled: state.refreshing, onClick: refreshAll, title: '重新拉取 CPA 摘要与账号明细（不触发上游配额探测）' },
          h('span', { className: state.refreshing ? 'cpa-spin' : undefined }, '↻'),
          state.refreshing ? '刷新中…' : '刷新',
        ),
        h(
          'button',
          { className: 'cpa-btn', style: btnBase, disabled: state.quotaSyncing, onClick: syncQuota, title: '向各账号上游逐一探测限额（每账号一次请求）' },
          h('span', { className: state.quotaSyncing ? 'cpa-spin' : undefined }, '↻'),
          state.quotaSyncing ? '同步中…' : '同步配额',
        ),
        h('button', { className: 'cpa-btn', style: btnBase, onClick: () => { store.set({ editing: true }); refreshConfig() } }, '更新配置'),
        st?.links?.cpaManagement
          ? h('button', { className: 'cpa-btn', style: { ...btnBase, marginLeft: 'auto' }, onClick: () => window.open(st.links.cpaManagement, '_blank') }, '管理页 ↗')
          : null,
      ].filter(Boolean))
    }

    // ---------- Overlay 面板 ----------
    function OverlayPanel() {
      const state = useStore()
      // 相位机：closed → open → closing（播完退场动画）→ closed。
      // 拆成两个 effect：若合并在一个依赖 [open, phase] 的 effect 里，phase 变 closing 触发重跑时
      // React 会先执行上一次 cleanup，把「170ms 后置 closed」的定时器清掉——面板卡死在
      // 不可见但仍挂载拦截点击的状态（footer 按钮被透明面板盖住，表现为「打不开」）。
      const [phase, setPhase] = useState('closed')
      useEffect(() => {
        if (state.open) setPhase('open')
        else setPhase((p) => (p === 'open' ? 'closing' : p))
      }, [state.open])
      useEffect(() => {
        if (phase !== 'closing') return
        const timer = setTimeout(() => setPhase('closed'), 170)
        return () => clearTimeout(timer)
      }, [phase])
      if (phase === 'closed') return null
      const st = state.status
      const showConfig = state.editing || !st || st.mode === 'needs_config'
      const ready = !showConfig && st?.ok
      const subtitle = st?.mode === 'ready' && st.config?.baseUrl ? hostOf(st.config.baseUrl) : null
      return h(
        'div',
        {
          className: phase === 'closing' ? 'cpa-panel-exit' : 'cpa-panel-enter',
          style: {
            position: 'fixed',
            left: 12,
            bottom: 52,
            width: 380,
            // ready 态面板高度固定：Tab 内容量差异再大，切换也不抖动；配置/异常态内容短，自适应即可
            height: ready ? 'min(640px, 72vh)' : undefined,
            maxHeight: '72vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: 16,
            boxShadow: 'var(--dsw-shadow-lv3, 0 10px 32px rgba(0,0,0,0.4))',
            pointerEvents: phase === 'closing' ? 'none' : 'auto', // shell.overlay 层本身 click-through，面板自行接管；退场时放行点击
            zIndex: 60,
          },
        },
        [
          // 固定头部：标题 + 关闭（不随内容滚动）
          h('div', { key: 'hd', style: { display: 'flex', alignItems: 'baseline', padding: '14px 16px 10px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 } }, [
            h('span', { style: { fontSize: 13, fontWeight: 600, color: T.label } }, showConfig ? '连接 CPA' : 'CPA 状态'),
            subtitle ? h('span', { style: { fontSize: 11, color: T.secondary, marginLeft: 8 } }, maskHost(subtitle)) : null,
            // 脱敏模式快捷开关（截图/共享屏幕前一点即打码；持久化到配置）
            h(
              'button',
              {
                className: 'cpa-btn',
                style: {
                  ...btnBase,
                  marginLeft: 'auto',
                  border: 'none',
                  padding: '2px 6px',
                  alignSelf: 'center',
                  color: state.privacy ? T.brand : T.secondary,
                  opacity: state.privacy ? 1 : 0.75,
                },
                onClick: togglePrivacy,
                title: state.privacy ? '脱敏模式已开启：邮箱/地址/名称/密钥提示已打码，点击关闭' : '开启脱敏模式：打码邮箱、地址、名称、密钥提示',
              },
              state.privacy ? '◉' : '◎',
            ),
            h(
              'button',
              {
                className: 'cpa-btn',
                style: { ...btnBase, border: 'none', padding: '2px 6px', alignSelf: 'center' },
                onClick: () => store.set({ open: false, editing: false }),
                title: '关闭',
              },
              '✕',
            ),
          ]),
          // 固定信息区：概要 chips + 异常提示 + 分段选择器（滚到底也能直接切 Tab）
          ready ? h(PanelInfo, { key: 'info' }) : null,
          // 滚动内容区
          h(
            'div',
            { key: 'body', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px 12px' } },
            showConfig ? h(ConfigCard) : h(StatusCard),
          ),
          // 固定底部操作条（账号再多也不用滚到底找按钮）
          ready ? h(OpsBar, { key: 'ops' }) : null,
        ],
      )
    }

    // ---------- 注册 ----------
    function apply(ctx) {
      // 动画/交互样式表（停止插件时随 effect 移除）
      ctx.effect(() => {
        const el = document.createElement('style')
        el.id = 'dsh-cpa-status-styles'
        el.textContent = CSS
        document.head.appendChild(el)
        return () => el.remove()
      })
      ctx.effect(() =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'cpa-status', order: 10 }, (props) => h(FooterEntry, props)),
        ),
      )
      ctx.effect(() =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'cpa-status-panel', order: 10 }, () => h(OverlayPanel)),
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
