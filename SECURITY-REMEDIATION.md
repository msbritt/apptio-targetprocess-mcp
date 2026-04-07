# Security Remediation Log

Documents fixes applied following the cross-reviewed security audit in `SECURITY-REVIEW.md`.

## Summary

| Bead | Severity | Finding | Status |
|------|----------|---------|--------|
| tpmcp-7dn | High | Delete auth bypass when User is null | ✅ Fixed |
| tpmcp-ejh | Medium | Incomplete mention sanitization | ✅ Fixed |
| tpmcp-yd3 | Medium | Token not URL-encoded in manual query builder | ✅ Fixed |
| tpmcp-78a | Low | Private field access via bracket notation | ✅ Fixed |
| tpmcp-aka | Low | `authUrl` fragile `?` handling | ✅ Fixed |
| tpmcp-shi | Low | Token may appear in retry error context | ✅ Fixed |
| tpmcp-c6x | Low | SSRF error leaks configured hostname | Won't Fix |
| tpmcp-okf | Low | `search-docs.sh` argument quoting unverified | ✅ Fixed |
| tpmcp-dcf | Low | Attachment paths unsanitized in markdown | ✅ Fixed |
| tpmcp-sa8 | Low | DNS rebinding on SSRF check (theoretical) | ✅ Documented |

---

## Fixes Applied

### High — Delete Auth Bypass When User Is Null (`delete-comment.ts`)

**Commit:** `28d2c9d`

The ownership check used optional chaining (`commentContext?.User &&`) which
evaluated to falsy when context was unavailable, silently skipping the check
and allowing deletion to proceed.

**Fix:** Restructured into two explicit cases:
- API error fetching context → return error response for non-managers (fail closed)
- Context fetched but null/no User → return Unauthorized for non-managers (fail closed)
- Managers bypass both checks

Also restored the original warn-then-allow behavior for non-owners with a
known `User` field — the prior code was incorrectly blocking rather than
warning, which contradicted the tests.

---

### Medium — Incomplete Mention Sanitization (`add-comment.ts`)

**Commit:** `3882da4`

The `resolveMentions` method only escaped single quotes (`'` → `''`), leaving
other TP OData operators potentially injectable inside quoted strings.

**Fix:** Replaced with an allowlist: `mention.replace(/[^A-Za-z0-9 .\-_@]/g, '')`.
Strips everything except characters valid in names, logins, and email addresses.

---

### Medium — Token Not URL-Encoded in Manual Query Builder (`query-builder.ts`)

**Commit:** `67385b6`

`buildQueryStringManual` used direct string interpolation for `access_token`,
inconsistent with the `URLSearchParams` path which encodes automatically.

**Fix:** `parts.push(`access_token=${encodeURIComponent(this.authConfig.token)}`)`.

---

### Low — Private Field Access via Bracket Notation (`tp.service.ts`, `query-builder.ts`)

**Commit:** `67385b6`

`tp.service.ts` accessed `this.queryBuilder['authConfig']` bypassing TypeScript
visibility rules.

**Fix:** Added `getAuthConfig(): AuthConfig` accessor to `QueryBuilder` and
updated `tp.service.ts` to use it.

---

### Low — `authUrl` Fragile `?` Handling (`comment.service.ts`)

**Commit:** `3e9b5f3`

`authUrl` appended `?access_token=...` unconditionally, which would produce a
malformed URL if the path already contained a query string.

**Fix:** Checks for existing `?` and uses `&` separator when needed:
```typescript
const sep = path.includes('?') ? '&' : '?';
```

---

### Low — Token May Appear in Retry Error Context (`http-client.ts`)

**Commit:** `e460b32`

The retry context string for `downloadBinary` was `download binary from ${url}`,
which would include any query parameters (such as `access_token=`) if they were
ever present in the URL.

**Fix:** Uses `new URL(url).pathname` to strip query string from the context
string logged in retry errors.

---

### Low — `search-docs.sh` Argument Quoting (`inspect.tool.ts`)

**Commit:** `342fdad`

`exec()` interpolated `searchTerm` into a shell command string, enabling shell
injection via the search term value.

**Fix:** Replaced with `execFile(scriptPath, [searchTerm], { cwd: docsPath })`.
The search term is passed as a positional argument, never interpreted by a shell.

---

### Low — Attachment Paths Unsanitized in Markdown (`add-comment.ts`)

**Commit:** `3882da4`

`att.description` and `att.path` were interpolated directly into
`<!--markdown-->` comment content. Markdown link/image syntax characters
(`[`, `]`, `(`, `)`) could inject links or images into stored comments.

**Fix:** Strips `[]()` from the label before inserting:
```typescript
const label = (att.description || att.path || '').replace(/[[\]()]/g, '');
```

---

## Won't Fix

### Low — SSRF Error Leaks Configured Hostname (`http-client.ts`)

The SSRF validation error messages include the configured TP hostname. The
security review rated this Low and noted the TP domain is not a secret — it is
present in environment configuration and known to all MCP users. The informative
messages are more useful for debugging than generic alternatives.

---

## Known Limitations

### Low — DNS Rebinding on SSRF Check (`http-client.ts`)

The hostname check in `downloadBinary` compares hostnames at request-build time.
A DNS rebinding attack could cause the hostname to resolve differently by the
time the actual TCP connection is made, bypassing the check.

This is an accepted limitation. Attachment URLs are sourced from the TP API
response, not from untrusted user input, making exploitation negligible in
practice. The check is documented in the source with this note.
