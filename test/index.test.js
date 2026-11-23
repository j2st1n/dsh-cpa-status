import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply } from '../src/index.js'

/** client.js 的源码：客户端半区在浏览器里跑，这里只做结构级断言（同 dsh-version-status）。 */
const clientSource = () => readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

/** 可信请求头：loopback 监听器，无 Origin（同源导航/本机调用）。 */
const TRUSTED_HEADERS = { host: '127.0.0.1:3080' }
/** 写请求需要 JSON content-type 才被放行。 */
const TRUSTED_WRITE_HEADERS = { ...TRUSTED_HEADERS, 'content-type': 'application/json' }

function request(method, url, body, headers = TRUSTED_HEADERS) {
  const payload = body === undefined
    ? []
    : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload)
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

async function invoke(route, method, url, body, headers = TRUSTED_HEADERS) {
  let status = null
  let text = ''
  const res = {
    writeHead(code) {
      status = code
    },
    end(chunk = '') {
      text += chunk
    },
  }
  await route.handler(request(method, url, body, headers), res)
  return { status, body: text ? JSON.parse(text) : null }
}

function harness(initialConfig, options = {}) {
  const routes = new Map()
  const credentials = new Map(Object.entries(options.credentials ?? {}))
  let config = { privacyMode: false, publicUrl: '', ...initialConfig }
  const scope = {
    get: () => ({ ...config }),
    update: async (patch) => {
      config = { ...config, ...patch }
    },
  }
  const modelEndpoint = options.modelEndpoint ?? null
  const ctx = {
    settings: {
      register: () => scope,
      get: (namespace) => namespace === 'test-model' ? { baseUrl: modelEndpoint } : undefined,
    },
    credentials: {
      describe: async (ref) => ({ configured: credentials.has(ref), source: 'store', writable: true }),
      resolve: async (ref) => credentials.has(ref) ? { value: credentials.get(ref) } : undefined,
      set: async (ref, value) => credentials.set(ref, value),
      unset: async (ref) => credentials.delete(ref),
    },
    webServer: {
      register: (route) => {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      // 监听器 bind 地址与 scheme：fence 用它们判定可信 Host。
      host: options.webServer?.host ?? '127.0.0.1',
      protocol: options.webServer?.protocol ?? 'http:',
    },
    effect: (factory) => factory(),
    get: (name) => {
      // 宿主 connection 服务（fence 的官方判定）；未提供时返回 null，
      // 与真实 cordis 缺服务时的形态一致（不是 undefined）。
      if (name === 'connection') return options.connection ?? null
      if (!modelEndpoint) return null
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test-provider' }) }
      if (name === 'llm') {
        return { listConfigurableProviders: () => [{ provider: 'test-provider', settingsNs: 'test-model', settingsPath: [] }] }
      }
      return null
    },
  }
  apply(ctx)
  return { routes, credentials, getConfig: () => ({ ...config }) }
}

test('config updates preserve omitted fields and probe CPA only once', async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => {
    fetches += 1
    return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const app = harness(
      { baseUrl: 'https://cpa.example.test', publicUrl: 'https://manage.example.test', privacyMode: true },
      { credentials: { CPA_MANAGEMENT_KEY: 'management-key' } },
    )
    const route = app.routes.get('/api/cpa-status/config')
    const saved = await invoke(route, 'PUT', '/api/cpa-status/config', { baseUrl: 'https://cpa.example.test' }, TRUSTED_WRITE_HEADERS)

    assert.equal(saved.status, 200)
    assert.equal(fetches, 1)
    assert.equal(app.getConfig().publicUrl, 'https://manage.example.test')
    assert.equal(app.getConfig().privacyMode, true)
    assert.equal(saved.body.probe.ok, true)

    const cleared = await invoke(route, 'PUT', '/api/cpa-status/config', {
      baseUrl: 'https://cpa.example.test',
      clearManagementKey: true,
    }, TRUSTED_WRITE_HEADERS)
    assert.equal(cleared.status, 200)
    assert.equal(app.getConfig().publicUrl, 'https://manage.example.test')
    assert.equal(app.getConfig().privacyMode, true)
    assert.equal(app.credentials.has('CPA_MANAGEMENT_KEY'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('config route rejects bodies larger than 64 KiB', async () => {
  const app = harness({ baseUrl: 'https://cpa.example.test' })
  const route = app.routes.get('/api/cpa-status/config')
  const response = await invoke(route, 'PUT', '/api/cpa-status/config', Buffer.alloc(64 * 1024 + 1, 97), TRUSTED_WRITE_HEADERS)

  assert.equal(response.status, 413)
  assert.equal(response.body.error.message, '请求体过大')
})

test('gateway URLs are reduced to their origin and private suffix tenants do not match', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    const endpoint = url.pathname.split('/').at(-1)
    if (endpoint === 'auth-files') {
      return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const entries = endpoint === 'gemini-api-key'
      ? [{
          name: 'sensitive gateway',
          'base-url': 'https://user:password@gateway.example.test/private/path?api_key=secret#fragment',
          'api-key': 'top-secret-key',
        }]
      : []
    return new Response(JSON.stringify({ [endpoint]: entries }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const app = harness(
      { baseUrl: 'https://alice.github.io' },
      {
        credentials: { CPA_MANAGEMENT_KEY: 'management-key' },
        modelEndpoint: 'https://bob.github.io/v1',
      },
    )
    const status = await invoke(app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status')
    assert.equal(status.status, 200)
    assert.equal(status.body.route.matchesCpa, false)

    const accounts = await invoke(app.routes.get('/api/cpa-status/accounts'), 'GET', '/api/cpa-status/accounts')
    assert.equal(accounts.status, 200)
    assert.equal(accounts.body.gateways[0].baseUrl, 'https://gateway.example.test')
    assert.equal(JSON.stringify(accounts.body).includes('user:password'), false)
    assert.equal(JSON.stringify(accounts.body).includes('api_key=secret'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sibling hosts under a registrable domain still match CPA', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ files: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

  try {
    const app = harness(
      { baseUrl: 'https://cpa.example.com' },
      {
        credentials: { CPA_MANAGEMENT_KEY: 'management-key' },
        modelEndpoint: 'https://api.example.com/v1',
      },
    )
    const status = await invoke(app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status')
    assert.equal(status.body.route.matchesCpa, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('apply succeeds even when ctx.settings lacks register function (real DSH host)', () => {
  const routes = new Map()
  const fakeCtx = {
    settings: {
      describe: () => [],
      update: async () => {},
    },
    credentials: {
      describe: async () => ({ configured: false }),
      resolve: async () => undefined,
    },
    webServer: {
      register: (opts) => routes.set(opts.path, opts),
    },
    effect: (fn) => fn(),
  }

  assert.doesNotThrow(() => apply(fakeCtx))
  assert.ok(routes.has('/api/cpa-status'))
  assert.ok(routes.has('/api/cpa-status/config'))
  assert.ok(routes.has('/api/cpa-status/accounts'))
})

// ---------------------------------------------------------------------------
// Host/Origin fence：exact 路由不经过宿主准入，路由必须自己拒绝伪造来源。
// 以下用例全部实际驱动注册的 handler（不启动端口，也不断言源码字符串）。
// ---------------------------------------------------------------------------

/** 让所有上游探测走空响应，避免 fence 用例打真实网络。 */
function stubUpstream() {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ files: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  return () => { globalThis.fetch = original }
}

test('fence：伪造 Host 与缺失 Host 的读请求被拒 403', async () => {
  const restore = stubUpstream()
  try {
    const app = harness({ baseUrl: 'https://cpa.example.test' })

    // DNS rebinding 形态：Origin 与 Host 同为攻击者域名，Origin 自洽也必须被 Host 白名单拒绝。
    const rebound = await invoke(
      app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined,
      { host: 'evil.example.test:3080', origin: 'http://evil.example.test:3080' },
    )
    assert.equal(rebound.status, 403)
    assert.equal(rebound.body.error.code, 'FORBIDDEN')

    const noHost = await invoke(
      app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {},
    )
    assert.equal(noHost.status, 403)

    // 三条路由都要挡住，不能只挡一下摘要。
    for (const path of ['/api/cpa-status', '/api/cpa-status/config', '/api/cpa-status/accounts']) {
      const res = await invoke(
        app.routes.get(path), 'GET', path, undefined,
        { host: 'evil.example.test:3080' },
      )
      assert.equal(res.status, 403, `${path} 必须拒绝伪造 Host`)
    }
  } finally {
    restore()
  }
})

test('fence：cross-site 读请求被拒 403', async () => {
  const restore = stubUpstream()
  try {
    const app = harness({ baseUrl: 'https://cpa.example.test' })

    // Host 是合法 loopback，仅靠 Sec-Fetch-Site 识别跨站。
    const crossSite = await invoke(
      app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined,
      { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    )
    assert.equal(crossSite.status, 403)
    assert.equal(crossSite.body.error.code, 'FORBIDDEN')

    const crossSiteAccounts = await invoke(
      app.routes.get('/api/cpa-status/accounts'), 'GET', '/api/cpa-status/accounts', undefined,
      { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    )
    assert.equal(crossSiteAccounts.status, 403)
  } finally {
    restore()
  }
})

test('fence：不匹配 Origin 的读请求被拒 403', async () => {
  const restore = stubUpstream()
  try {
    const app = harness({ baseUrl: 'https://cpa.example.test' })
    const route = app.routes.get('/api/cpa-status')

    const foreignOrigin = await invoke(route, 'GET', '/api/cpa-status', undefined, {
      host: '127.0.0.1:3080',
      origin: 'http://evil.example.test',
    })
    assert.equal(foreignOrigin.status, 403)
    assert.equal(foreignOrigin.body.error.code, 'FORBIDDEN')

    // 端口不同即不同 authority。
    const otherPort = await invoke(route, 'GET', '/api/cpa-status', undefined, {
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:9999',
    })
    assert.equal(otherPort.status, 403)

    // 非 http(s) Origin 视为不匹配。
    const nullOrigin = await invoke(route, 'GET', '/api/cpa-status', undefined, {
      host: '127.0.0.1:3080',
      origin: 'null',
    })
    assert.equal(nullOrigin.status, 403)
  } finally {
    restore()
  }
})

test('fence：PUT 用非 JSON content-type 返回 415 且不改配置', async () => {
  const restore = stubUpstream()
  const app = harness(
    { baseUrl: 'https://cpa.example.test', publicUrl: 'https://manage.example.test', privacyMode: false },
    { credentials: { CPA_MANAGEMENT_KEY: 'management-key' } },
  )
  try {
    const route = app.routes.get('/api/cpa-status/config')

    for (const contentType of ['text/plain', undefined, 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const headers = contentType === undefined
        ? { host: '127.0.0.1:3080' }
        : { host: '127.0.0.1:3080', 'content-type': contentType }
      const res = await invoke(route, 'PUT', '/api/cpa-status/config', {
        baseUrl: 'https://attacker.example',
        managementKey: 'attacker-key',
      }, headers)
      // 415 而不是 403：来源可信但实体格式不受支持，与宿主 client-connection 对齐。
      assert.equal(res.status, 415, `content-type=${contentType} 必须被拒 415`)
      assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE')
    }

    // 关键：被拒的写请求绝不能落盘。
    assert.equal(app.getConfig().baseUrl, 'https://cpa.example.test')
    assert.equal(app.credentials.get('CPA_MANAGEMENT_KEY'), 'management-key')
  } finally {
    restore()
  }
})

test('fence：伪造来源的 PUT 被拒 403，配置与密钥均不被改写', async () => {
  const restore = stubUpstream()
  const app = harness(
    { baseUrl: 'https://cpa.example.test', publicUrl: 'https://manage.example.test', privacyMode: false },
    { credentials: { CPA_MANAGEMENT_KEY: 'management-key' } },
  )
  try {
    const route = app.routes.get('/api/cpa-status/config')
    // 复现原始漏洞的攻击组合：伪造 Host + 跨站 Origin + cross-site + text/plain。
    const attack = await invoke(route, 'PUT', '/api/cpa-status/config', {
      baseUrl: 'https://attacker.example',
      managementKey: 'attacker-key',
    }, {
      host: 'evil.example.test:3080',
      origin: 'http://evil.example.test:3080',
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
    })
    assert.equal(attack.status, 403)
    assert.equal(attack.body.error.code, 'FORBIDDEN')

    assert.equal(app.getConfig().baseUrl, 'https://cpa.example.test')
    assert.equal(app.credentials.get('CPA_MANAGEMENT_KEY'), 'management-key')
  } finally {
    restore()
  }
})

test('fence：正常 loopback 的 GET 与合法 JSON 的 PUT 放行', async () => {
  const restore = stubUpstream()
  const app = harness(
    { baseUrl: 'https://cpa.example.test', publicUrl: 'https://manage.example.test', privacyMode: false },
    { credentials: { CPA_MANAGEMENT_KEY: 'management-key' } },
  )
  try {
    for (const path of ['/api/cpa-status', '/api/cpa-status/config', '/api/cpa-status/accounts']) {
      const res = await invoke(app.routes.get(path), 'GET', path)
      assert.equal(res.status, 200, `${path} 应放行 loopback GET`)
    }

    // localhost 与同源 Origin（默认端口按 Origin 的 scheme 归一化）同样放行。
    const localhost = await invoke(app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: 'localhost:3080',
      origin: 'http://localhost:3080',
      'sec-fetch-site': 'same-origin',
    })
    assert.equal(localhost.status, 200)

    // 合法 JSON PUT 照常保存，客户端实际发的就是这个组合。
    const saved = await invoke(app.routes.get('/api/cpa-status/config'), 'PUT', '/api/cpa-status/config', {
      baseUrl: 'https://cpa2.example.test',
    }, { host: '127.0.0.1:3080', 'content-type': 'application/json; charset=utf-8' })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.saved, true)
    assert.equal(app.getConfig().baseUrl, 'https://cpa2.example.test')
  } finally {
    restore()
  }
})

test('fence：监听器 bind 地址与 connection 官方判定同样可放行', async () => {
  const restore = stubUpstream()
  try {
    // bind 到非 loopback 地址时，该地址本身可信。
    const bindApp = harness({ baseUrl: 'https://cpa.example.test' }, { webServer: { host: '192.168.1.10' } })
    const bindRes = await invoke(bindApp.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: '192.168.1.10:3080',
    })
    assert.equal(bindRes.status, 200)

    // connection.trustedHosts 中的 Host 可信。
    const trustedApp = harness({ baseUrl: 'https://cpa.example.test' }, {
      connection: { trustedHosts: ['harness.internal:3080'] },
    })
    const trusted = await invoke(trustedApp.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: 'harness.internal:3080',
    })
    assert.equal(trusted.status, 200)
    const untrusted = await invoke(trustedApp.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: 'other.internal:3080',
    })
    assert.equal(untrusted.status, 403)

    // 宿主提供 isTrusted 时以其判定为准：判否的 loopback 也要拒，判可的非 loopback 也要放。
    const officialApp = harness({ baseUrl: 'https://cpa.example.test' }, {
      connection: { isTrusted: (req) => req.headers?.host === 'harness.internal:3080' },
    })
    const officialReject = await invoke(officialApp.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: '127.0.0.1:3080',
    })
    assert.equal(officialReject.status, 403)
    const officialAccept = await invoke(officialApp.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: 'harness.internal:3080',
    })
    assert.equal(officialAccept.status, 200)

    // isTrusted 抛错时降级为不可信，不得把异常包成 200。
    const throwingApp = harness({ baseUrl: 'https://cpa.example.test' }, {
      connection: { isTrusted: () => { throw new Error('boom') } },
    })
    const throwing = await invoke(throwingApp.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: '127.0.0.1:3080',
    })
    assert.equal(throwing.status, 403)
  } finally {
    restore()
  }
})

test('fence：非 GET 方法在 fence 之后仍返回 405', async () => {
  const restore = stubUpstream()
  const app = harness({ baseUrl: 'https://cpa.example.test' })
  try {
    // 可信来源的 POST 落到 handler 内部的方法判定。
    const trustedPost = await invoke(app.routes.get('/api/cpa-status'), 'POST', '/api/cpa-status', undefined, TRUSTED_WRITE_HEADERS)
    assert.equal(trustedPost.status, 405)

    // 与 opencode 语义一致：fencedRead 只围栏 GET，其余方法由 handler 的方法判定处理
    // （该分支不返回任何状态数据，不构成读取面）。
    const untrustedPost = await invoke(app.routes.get('/api/cpa-status'), 'POST', '/api/cpa-status', undefined, {
      host: 'evil.example.test:3080',
    })
    assert.equal(untrustedPost.status, 405)

    // 不可信来源的 GET 才是真正的读取面，必须在进入 handler 前被拒。
    const untrustedGet = await invoke(app.routes.get('/api/cpa-status'), 'GET', '/api/cpa-status', undefined, {
      host: 'evil.example.test:3080',
    })
    assert.equal(untrustedGet.status, 403)
  } finally {
    restore()
  }
})

// ---------------------------------------------------------------------------
// 侧栏悬停预览（client.js）：折叠 rail 的 fixed 定位与限高。
// 客户端半区依赖宿主 React 与 DOM，跑不了完整渲染；这里按 dsh-version-status
// 的既有做法做源码结构断言，锁住本轮修复的关键点，防止回退成 absolute。
// ---------------------------------------------------------------------------

test('client：折叠 rail 的悬停卡片走 fixed 定位、量位置并限高', () => {
  const source = clientSource()

  // 220ms 延时保持与参考插件一致；measure 必须在 setHovering 之前完成，避免首帧错位。
  assert.match(source, /HOVER_PREVIEW_DELAY\s*=\s*220/)
  assert.match(source, /if \(isFolded\) measureHoverPos\(\)\s*\n\s*setHovering\(true\)/)
  assert.match(source, /\},\s*HOVER_PREVIEW_DELAY\)/)

  // 折叠态：用 ref 量触发器 getBoundingClientRect，改 position: fixed。
  assert.match(source, /triggerRef\.current\?\.getBoundingClientRect\?\.\(\)/)
  assert.match(source, /if \(!rect\) return/)
  assert.match(source, /position: 'fixed',/)

  // 宽度固定为可读尺寸，水平方向夹在视口内。
  assert.match(source, /HOVER_PREVIEW_WIDTH\s*=\s*236/)
  assert.match(source, /width: HOVER_PREVIEW_WIDTH,/)
  assert.match(source, /left \+ HOVER_PREVIEW_WIDTH > viewportWidth - 8/)
  assert.match(source, /left = Math\.max\(8, viewportWidth - HOVER_PREVIEW_WIDTH - 8\)/)
  assert.match(source, /left: hoverPos \? hoverPos\.left : 8,/)
  assert.match(source, /bottom: hoverPos \? hoverPos\.bottom : 8,/)

  // 高度上限：账号多时卡片内部滚动，不再向上溢出屏幕。
  assert.match(source, /HOVER_PREVIEW_MAX_HEIGHT = 'min\(360px, 50vh\)'/)
  assert.match(source, /maxHeight: HOVER_PREVIEW_MAX_HEIGHT,/)
  assert.match(source, /overflowY: 'auto',/)

  // 折叠 / 展开切换时重算位置。
  assert.match(source, /if \(!hovering \|\| !isFolded\) return/)
  assert.match(source, /\[isFolded, hovering\]/)
})

test('client：宽侧栏定位与悬停显示前置条件保持不变', () => {
  const source = clientSource()

  // 宽侧栏仍是原来的 absolute + left/right 0 + 向上 6px。
  assert.match(source, /position: 'absolute',/)
  assert.match(source, /left: 0,\s*\n\s*right: 0,\s*\n\s*bottom: 'calc\(100% \+ 6px\)',/)

  // 显示前置条件不得放宽：未悬停 / 面板打开 / 非 ready / 不健康一律不渲染卡片。
  assert.match(source, /if \(!hovering \|\| state\.open \|\| st\?\.mode !== 'ready' \|\| !st\.ok\) return node/)

  // 进入 / 离开仍成对挂在按钮（以及悬停包裹层）上。
  assert.equal((source.match(/onMouseEnter,/g) || []).length, 2)
  assert.equal((source.match(/onMouseLeave,/g) || []).length, 2)

  // 卡片内容仍遍历账号池（高度上限针对的正是这条渲染路径）。
  assert.match(source, /accounts\.map\(\(a, i\) => \{/)
})

// ---------------------------------------------------------------------------
// 悬停纯读缓存（client.js）：悬停不再预取账号，缓存为空时省略账号区。
// 账号预取只保留在打开面板的路径（openOverlay / StatusCard），见下方调用点计数。
// ---------------------------------------------------------------------------

test('client：悬停是纯读，不在 220ms 回调里预取账号', () => {
  const source = clientSource()
  const hoverCb = source.match(/hoverTimerRef\.current = setTimeout\(\(\) => \{([\s\S]*?)\}, HOVER_PREVIEW_DELAY\)/)
  assert.ok(hoverCb, '悬停 220ms 计时回调应存在')
  // 回调只切状态（必要时量位置），不得触发 refreshAccounts / fetch。
  assert.doesNotMatch(hoverCb[1], /refreshAccounts/)
  assert.doesNotMatch(hoverCb[1], /fetch\(/)
  assert.match(hoverCb[1], /setHovering\(true\)/)

  // refreshAccounts 的调用点只剩定义 + 面板/手动路径：
  // syncQuota、openOverlay、refreshAll、StatusCard 预取、配置保存。
  assert.equal((source.match(/refreshAccounts\(/g) || []).length, 6)
  assert.match(source, /refreshStatus\(false\)\.then\(\(\) => refreshAccounts\(false, false\)\)/)
  assert.match(source, /mode === 'ready' && st\.ok && !state\.accounts && !state\.accountsLoading\) refreshAccounts\(false\)/)
})

test('client：账号缓存为空时卡片省略账号区且不显示占位行', () => {
  const source = clientSource()

  // 占位行已删除；账号区整段由 accounts.length > 0 控制。
  assert.doesNotMatch(source, /正在读取账号池/)
  assert.match(source, /accounts\.length > 0\s*\n\s*\? h\(/)

  // 不依赖额外请求的部分保留：卡片标题与 traffic 统计仍来自 status。
  assert.match(source, /CPA 账号池与网关概览/)
  assert.match(source, /次\/30min · 成功率/)
})
