# Security notes

- The CPA management key is stored only in the host credentials store (`CPA_MANAGEMENT_KEY`); API responses never return the full key.
- Host routes are local to the DSH web server and return allowlisted account fields only (no raw upstream bodies, tokens, cookies, or full gateway secrets).
- Host routes are guarded against untrusted origins. All three routes (`/api/cpa-status`, `/api/cpa-status/config`, `/api/cpa-status/accounts`) are registered with `kind: 'exact'`, which bypasses the host's `/api` prefix admission, so the plugin applies an equivalent fence itself: the Host header must be loopback, the listener bind address, or listed in `connection.trustedHosts`; `Sec-Fetch-Site: cross-site` is rejected; a supplied Origin must match the same authority. Forged Host (DNS rebinding), cross-site and mismatched-origin requests get 403 instead of data. The `PUT /api/cpa-status/config` write path additionally requires `application/json` (415 otherwise) and runs the fence before the request body is parsed, so a rejected write cannot rewrite `baseUrl` or overwrite the management key.
  - Boundary: the fence blocks **browser origins** and DNS rebinding only. It does **not** authenticate same-host processes that can reach the loopback port.
- Gateway keys are displayed as last-four only in the UI; privacy mode can further mask emails, addresses, and names.
- The hover preview reads cached status only and issues no network requests; account details are prefetched exclusively when the panel opens.
- Quota probing is manual (`?quota=1`) and uses CPA's `$TOKEN$` placeholder injection — this plugin does not persist upstream credentials itself.
- Please report security issues privately via GitHub Security Advisories on this repository.
