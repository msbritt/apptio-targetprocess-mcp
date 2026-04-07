# Security Review — Cross-Reviewed Findings

## Methodology
- **Reviewer A** (Opus) and **Reviewer B** (Opus): independent security audits
- **Cross-Reviewer A→** (Sonnet): evaluated Reviewer A's findings
- **Cross-Reviewer B→** (Sonnet): evaluated Reviewer B's findings
- Findings are merged, with consensus severity ratings

## Positive Changes (Unanimous Agreement)

| Fix | File | Impact |
|-----|------|--------|
| `exec()` → `execFile()` | `inspect.tool.ts:296` | **Eliminates critical command injection** |
| SSRF hostname + protocol validation | `http-client.ts:231-250` | Prevents arbitrary URL fetching |
| `sanitizeIdentifier()` allowlist | `add-comment.ts:14-18`, `show-comments.ts:12-16` | Prevents query injection in where clauses |
| Single-quote escaping for mentions | `add-comment.ts:491` | Basic where-clause injection protection |
| Removed `convertMarkdownToHtml()` | `add-comment.ts` | **Eliminates large stored XSS surface** |
| Authorization check on delete | `delete-comment.ts:51-61` | Ownership validation (with caveats below) |
| `authUrl()` for comment endpoints | `comment.service.ts` | Fixes broken API key auth for comments |

---

## Confirmed Findings (Consensus)

### HIGH — Delete Authorization Bypass via Null User

**File:** `delete-comment.ts:53` | **Both reviewers found, both cross-reviewers upgraded to High**

```typescript
if (commentContext?.User && commentContext.User.Id !== context.user.id && !managerRoles.includes(context.user.role)) {
```

Two compounding issues:
1. **Null bypass**: If `getCommentContext()` fails or returns no `.User` field, the entire check is skipped and deletion proceeds unchecked. Absence of ownership data should **deny**, not **allow**.
2. **Self-asserted identity**: `context.user.id` and `context.user.role` come from env vars (`TP_USER_ID`, `TP_USER_ROLE`), not server-validated session identity.

**Remediation:**
```typescript
if (!commentContext?.User || 
    (commentContext.User.Id !== context.user.id && !managerRoles.includes(context.user.role))) {
  // deny
}
```
Add a comment documenting this as defense-in-depth; true authorization depends on the TP API credential.

---

### MEDIUM — Incomplete Mention Sanitization

**File:** `add-comment.ts:491` | **Both reviewers found; cross-reviewers disagreed on severity**

Cross-reviewer for B argued single-quote escaping is sufficient inside a quoted string. Cross-reviewer for A upgraded to Medium, noting that TP's OData-like query language may interpret operators even within quotes. Given mentions come from untrusted MCP tool input, Medium is the conservative call.

**Remediation:**
```typescript
const safeMention = mention.replace(/[^A-Za-z0-9 .\-_@]/g, '');
```

---

### MEDIUM — Token Not URL-Encoded in `buildQueryStringManual`

**File:** `query-builder.ts:171` | **Both reviewers found; cross-reviewers downgraded to Low**

Both cross-reviewers noted TP tokens are typically alphanumeric, making exploitability negligible. However, this is an inconsistency with two other code paths that do encode. Keeping at Medium as a correctness/defense-in-depth issue.

**Remediation:**
```typescript
parts.push(`access_token=${encodeURIComponent(this.authConfig.token)}`);
```

---

### LOW — Token May Appear in Retry Error Context

**File:** `http-client.ts:266` | **Both reviewers found**

Cross-reviewer for B noted that `downloadBinary` URLs likely don't contain the token (auth is via headers or constructed elsewhere). Low is appropriate.

**Remediation:** Strip query params from URL in retry context string:
```typescript
const safeLogUrl = new URL(url).pathname;
// use safeLogUrl in retry context
```

---

### LOW — SSRF Error Leaks Configured Hostname

**File:** `http-client.ts:238-239` | **Both reviewers found**

Cross-reviewers agreed Low is correct. TP domain is not truly secret.

**Remediation:** Generic message without hostnames.

---

### LOW — `authUrl` Fragile `?` Prepend

**File:** `tp.service.ts:490`, `comment.service.ts:53` | **Both reviewers found**

Cross-reviewer for A downgraded from Medium to Low — all current callers pass clean paths. Latent defect, not current vulnerability.

**Remediation:** Check for existing `?` before appending.

---

### LOW — Private Field Access via Bracket Notation

**File:** `tp.service.ts:489` | **Both reviewers found**

Design smell, not a runtime vulnerability. Agreed Low.

**Remediation:** Add `getAuthConfig()` accessor to `QueryBuilder`.

---

### LOW — DNS Rebinding on SSRF Check

**File:** `http-client.ts:235` | **Reviewer A only**

Theoretical; URLs come from TP API responses, not user input. Agreed Low.

---

## Newly Surfaced by Cross-Reviewers

### LOW — `search-docs.sh` Not Reviewed Post-execFile Fix

**Surfaced by:** Cross-reviewer for B

The `exec` → `execFile` fix passes `searchTerm` as `argv[1]` to `search-docs.sh`. If that script uses `eval`, unquoted expansion, or passes the arg to another command unsafely, argument injection is still possible. **Residual risk requiring script review.**

### LOW — Attachment Paths Inserted into Markdown Comments Unsanitized

**Surfaced by:** Cross-reviewer for A (`add-comment.ts`, `formatPlainTextComment`)

`att.description` and `att.path` are interpolated into `<!--markdown-->` content. Malicious values could inject Markdown links/images into stored comments.

---

## Final Summary

| # | Severity | Finding | File |
|---|----------|---------|------|
| 1 | **High** | Delete auth bypassed when User is null; self-asserted identity | `delete-comment.ts:53` |
| 2 | **Medium** | Mention sanitization incomplete (only single quotes) | `add-comment.ts:491` |
| 3 | **Medium** | Token not URL-encoded in manual query builder | `query-builder.ts:171` |
| 4 | Low | Token may leak in retry error context | `http-client.ts:266` |
| 5 | Low | SSRF error reveals configured hostname | `http-client.ts:238` |
| 6 | Low | `authUrl` fragile `?` handling | `comment.service.ts:53` |
| 7 | Low | Private field access via bracket notation | `tp.service.ts:489` |
| 8 | Low | DNS rebinding on SSRF check (theoretical) | `http-client.ts:235` |
| 9 | Low | `search-docs.sh` argument handling unverified | `inspect.tool.ts:297` |
| 10 | Low | Unsanitized attachment paths in markdown content | `add-comment.ts` |

**Overall: 0 Critical, 1 High, 2 Medium, 7 Low. The changeset is strongly net-positive for security.**
