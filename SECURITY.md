# Security notes

- The CPA management key is stored only in the host credentials store (`CPA_MANAGEMENT_KEY`); API responses never return the full key.
- Host routes are local to the DSH web server and return allowlisted account fields only (no raw upstream bodies, tokens, cookies, or full gateway secrets).
- Gateway keys are displayed as last-four only in the UI; privacy mode can further mask emails, addresses, and names.
- Quota probing is manual (`?quota=1`) and uses CPA's `$TOKEN$` placeholder injection — this plugin does not persist upstream credentials itself.
- Please report security issues privately via GitHub Security Advisories on this repository.
