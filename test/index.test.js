import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply } from '../src/index.js'

function request(method, url, body) {
  const payload = body === undefined
    ? []
    : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload)
  req.method = method
  req.url = url
  return req
}

async function invoke(route, method, url, body) {
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
  await route.handler(request(method, url, body), res)
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
    },
    effect: (factory) => factory(),
    get: (name) => {
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
    const saved = await invoke(route, 'PUT', '/api/cpa-status/config', { baseUrl: 'https://cpa.example.test' })

    assert.equal(saved.status, 200)
    assert.equal(fetches, 1)
    assert.equal(app.getConfig().publicUrl, 'https://manage.example.test')
    assert.equal(app.getConfig().privacyMode, true)
    assert.equal(saved.body.probe.ok, true)

    const cleared = await invoke(route, 'PUT', '/api/cpa-status/config', {
      baseUrl: 'https://cpa.example.test',
      clearManagementKey: true,
    })
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
  const response = await invoke(route, 'PUT', '/api/cpa-status/config', Buffer.alloc(64 * 1024 + 1, 97))

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
