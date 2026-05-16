# Beads Audit — Gaps in the 2026-05-16 Opus + Codex Review

## Context

The 32 open beads in `.beads/issues.jsonl` are the output of a security + code review by Opus and Codex on 2026-05-16. Unlike the April cycle (which left a written `SECURITY-REVIEW.md` + `SECURITY-REMEDIATION.md`), this round produced no companion report — only the beads. This document records gaps the new review may have missed, identified by reading the 32 open beads, the 19 closed beads from the prior cycle, and auditing `src/`, `package.json`, `eslint.config.js`, `tsconfig.json`.

## How to read this

- **NEW** — file a new bead. Distinct issue from anything tracked.
- **EXPAND** — extend an existing bead's scope. Same root cause, broader surface.
- **MAYBE** — depends on judgment / context not captured here; flag before filing.

Severity labels match `bd` priorities: P0 critical, P1 high, P2 medium, P3 low, P4 backlog.

---

## NEW — Significant gaps

### 1. Pagination cache: unbounded leak; sweeper is dead code  *(P2)*
**File:** `src/utils/paginator.ts:13,114`
`paginationCache` is a module-level `Map<string,string>`. `clearOldCache()` is exported but **never called anywhere** (no `setInterval`, no caller in `src/`). `getFullContent()` also never deletes after serving. Long-running stdio servers leak proportional to result-set size × session length, and entries persist across logical user contexts. Compounds with the `Math.random()` cache-key collision risk at line 66.

### 2. Prompt-injection surface broader than tpmcp-zd2  *(P2 — EXPAND or sibling bead)*
`tpmcp-zd2` covers only `linkedCommit`. The same untrusted-string-into-LLM-suggestions pattern occurs across multiple ops:
- `src/operations/work/add-comment.ts:863` — `entity.Project.Name`, `workflowStage.currentState`
- `src/operations/work/complete-task.ts:185` — `completedTask.Project.Name`
- `src/operations/work/show-my-bugs.ts:267-269` — `criticalBugs[0].Name`, `openBugs[0].Name`
- `src/operations/work/log-time.ts:191` — `entity.Name`
- `src/operations/work/show-comments.ts:745` — `entity.Name`

A TP user with edit access can craft a Name like `Existing\n\nSYSTEM: ...` and have it appear in assistant suggestions. Either expand tpmcp-zd2's scope or open a sibling bead listing these locations.

### 3. Phantom semantic operations referenced by personality + suggestion strings  *(P2)*
`src/operations/work/index.ts:69-74` lists 5 commented-out ops: `update-progress`, `pause-work`, `investigate-bug`, `mark-bug-fixed`, `show-time-spent`. These IDs are still referenced in:
- `src/core/personality-loader.ts:67-74` (advertised by personalities)
- `src/core/operation-registry.ts:178`
- Suggestion strings in `add-comment.ts:837`, `start-working-on.ts:145`, `show-my-tasks.ts:221`

Personalities advertise operations that don't exist; the LLM is told to call missing operations. Either implement or remove the references.

### 4. `show-my-tasks` does not actually filter to "my" tasks  *(P2)*
`src/operations/work/show-my-tasks.ts:50` and `:138` carry untracked TODOs: `Find correct syntax for AssignedUser filtering` and `Fix orderBy parameter format`. Result: the op fetches a broad set and filters in-process. At scale this returns wrong results (top-N by client-side filter ≠ assigned-to-me).

### 5. `TP_DOMAIN` accepted without validation / scheme enforcement  *(P2)*
`src/api/client/tp.service.ts:66` interpolates the env var raw into `https://${config.domain}/api/v1`. `TP_DOMAIN=trusted.com@evil.com` becomes a userinfo-injected URL; `TP_DOMAIN=evil.com#` and similar produce parser-quirky URLs. The SSRF check in `http-client.ts` for attachments compares hostnames *after* the base URL is built, so a poisoned `TP_DOMAIN` poisons the SSRF check too. Exploit requires env-var control (low practical risk) but is a robustness/defense gap.

### 6. `update_entity` and `create_entity` Zod schemas drop most of the API surface  *(P3)*
`src/tools/update/update.tool.ts:7-19` only accepts `name`, `description`, `status`, `assignedUser`. Cannot set Priority, Effort, EntityState by name, CustomFields, Project, Feature/UserStory parent, etc. `create.tool.ts` is similarly minimal. The underlying `TPService.updateEntity` / `createEntity` take arbitrary payloads; the Zod schema is the bottleneck. Tracked beads cover validator/operator/quote bugs — none cover this functional gap.

### 7. Server constructor fires `initializeCache()` without await  *(P2)*
`src/server.ts:184` calls `this.initializeCache()` from the constructor and the promise floats. Requests can be served before context is built. Mutation of `this.context` races with the resource-provider replacement (~line 180). Distinct from tpmcp-tyj (cache-init shape-fragility) and tpmcp-bqo (parallelism within the probes themselves).

### 8. Inconsistent error envelope: semantic ops vs raw tools  *(P3)*
Raw tools throw `McpError` (e.g. `get.tool.ts`, `update.tool.ts`). Semantic operations (`show-my-tasks.ts:172`, `start-working-on.ts:159`, `log-time.ts:181`, …) wrap `execute()` in try/catch and return `{type:'error', text:...}` content blocks. The MCP host treats only thrown errors as `isError: true`; semantic-op failures render as plain text and lose error semantics.

### 9. Wrong `McpError` code — `InvalidRequest` for server/transient errors  *(P3)*
`src/api/http/http-client.ts:147-150` returns `InvalidRequest` for retry exhaustion (network failure). `tp.service.ts:506-509` returns `InvalidRequest` for `Failed to parse /meta response` regardless of whether cause was network/401/parse. Should be `InternalError` for those paths.

### 10. Unused runtime dependencies — `axios`, `node-fetch`  *(P3 — supply-chain hygiene)*
`package.json:52,54` declare `axios ^1.11.0` and `node-fetch ^3.3.2`, but `grep -rn 'axios\|node-fetch' src/` returns zero. The codebase uses `globalThis.fetch`. Future CVEs in either pull vulnerable code into the install with no benefit. `41a6b5f` was titled "switch http clients to native fetch" — this is leftover.

### 11. Module-level constructor side effects  *(P3)*
- `src/utils/logger.ts:22-28` — `StrictMCPLogger` reads `process.stdin.isTTY` and writes stderr in the constructor. `export const logger = new StrictMCPLogger()` fires this at import time of every importer.
- `src/core/personality-loader.ts:31` — `readdirSync` / `readFileSync` in constructor; module-level singleton runs that at import.
- `src/core/operation-registry.ts:340` — module-level singleton populates personality maps in constructor.

### 12. ESLint config can't enforce the type-safety beads  *(P3)*
`eslint.config.js:30,65` has `@typescript-eslint/no-explicit-any: 'warn'`. tpmcp-2z2 (pervasive `any`) cannot be enforced in CI. No `no-floating-promises`, `require-await`, or `no-misused-promises` rules — exactly the failure modes in finding #7.

### 13. `Promise.all` collapses partial-success in `show-comments.ts:88`  *(P3)*
`Promise.all([fetchEntity, getComments, discoverCommentCapabilities])` rejects the whole call when any single sub-call fails. The op's docblock advertises graceful degradation. Either use `Promise.allSettled` or scope the try/catch tighter.

### 14. Logger stringifies arbitrary error objects — possible token leak  *(P3, MAYBE-confidence)*
`src/utils/logger.ts:38-39` JSON-stringifies `...args`. Callers pass raw `error` objects (`tp.service.ts:297,398`, `entity-validator.ts:59,161,183`, `http-client` rethrows). If a native fetch error's `error.cause` ever carries the request URL (with `access_token=` query param), it lands in stderr. Worth a manual trace through retry paths to confirm `error.cause` content; native fetch error shape varies by failure mode.

### 15. No outbound rate limit / amplification cap  *(P3)*
Nothing in `http-client.ts` or `tp.service.ts` caps request rate. `search-work-items` fans out to N entity types; `show-comments` runs Promise.all batches; `getValidEntityTypes` probes 10 types (tpmcp-bqo tracks parallelism but not capping). A misbehaving LLM driving repeated calls turns the MCP server into an amplifier against the configured TP tenant.

### 16. Sensitive paths echoed in config-load error  *(P4)*
`src/server.ts:77-89` — `loadConfig` builds error text containing the full list of attempted absolute paths (including `$HOME` / username) and throws as `McpError`. The MCP client (and LLM) sees username portions of paths.

### 17. `Math.random()` for cache keys (collision risk)  *(P4)*
`src/utils/paginator.ts:66`. Two pages requested in the same millisecond from the same Math.random sequence can collide; one entry overwrites the other's full text. Not security-critical, but a real correctness bug. Use `crypto.randomUUID()`.

### 18. Comment-formatter recursion has no depth cap  *(P4)*
`src/operations/work/show-comments.ts:854-903`. Hierarchy builder is iterative and Map-based (no cycles possible), but `formatEnhancedComment` recurses on `replies`. A long legitimate (or adversarial) reply chain can blow the stack. Add a `MAX_DEPTH` constant.

### 19. Build/install-time scripts surprise users  *(P4)*
- `package.json:37` — `prepare` runs full build on every `npm install` unless `NODE_ENV=production`. Slow.
- `package.json:36` — `build` redirects compile output to `/tmp/apptio-mcp-tsc.log` and tails 20 lines on failure. CI diagnostics suffer.
- `package.json:47-48` — `start`/`mcp` scripts don't depend on `build`; running stale code on an out-of-date `build/` directory is easy.

### 20. Duplicated state-discovery logic across operations  *(P4)*
`(EntityType.Name eq 'X') and (IsFinal eq true)` query reimplemented in `start-working-on.ts:71-87`, `complete-task.ts:71-83`, `show-my-tasks.ts:55-67`, `show-my-bugs.ts:50-66`, with drifted fallback strings (`'Done'` vs `'Closed'` vs `'Fixed'`). Centralize in `EntityValidator` or a state helper.

### 21. `EntityRegistry` (sync, static) vs `EntityValidator` (async, dynamic) disagree on validity  *(P3)*
`src/tools/entity/create.tool.ts:46` uses `EntityRegistry.isValidEntityType` (static list). All other code paths use `EntityValidator.validateEntityTypeOrThrow` (dynamic, cached). Custom entity types known at runtime are accepted everywhere except `create_entity`. tpmcp-nax is about registry mutation cadence — this is about callsites disagreeing on which validator to use.

### 22. Stale interface declarations in `src/core/interfaces/`  *(P4)*
`tp-service.interface.ts` declares `ITPService`, `ITPHttpClient`, `ITPAuthService`, never implemented (`TPService` does not `implements` them) and never imported. Same for `IQueryBuilder`, `IConfigService`. Drifted documentation surface. Either implement or delete.

### 23. Untracked TODOs in source  *(P4)*
- `src/operations/work/start-working-on.ts:121` — "Add comment creation once we understand the correct API" (but `complete-task.ts:111-122` already implements this pattern).
- `src/server.ts:262` — username derived from email split.
- `src/tools/search/search.tool.ts:120` — `${currentUser}` substitution silently leaves the placeholder unresolved.

Each one is small; together they're contract drift. File a single sweep bead.

---

## EXPAND — Beads whose scope is narrower than the underlying issue

| Bead | Current scope | Suggested expansion |
|------|---------------|---------------------|
| `tpmcp-zd2` | linkedCommit only | Audit all op suggestion-string builders for raw-entity-field interpolation (Finding #2). |
| `tpmcp-tyj` / `tpmcp-bqo` | cache-init race / serial probes | Add Finding #7 (server constructor fires un-awaited cache init) — distinct from both. |

---

## MAYBE — Worth a human call before filing

- **Finding #14 (logger token leak)** — confidence is medium; depends on whether native fetch's `error.cause` ever carries the full URL with query string. A 30-minute trace-through would resolve it. Worth filing as an "investigate" bead with that scope.
- **Finding #15 (rate limit)** — depends on whether TP rate limits are sufficient as the only line of defense. If yes, drop it; if no, file it.
- **Finding #6 (update/create schema)** — could be intentional minimalism for early-stage MCP. Confirm with the maintainer before filing.

---

## Categories checked, nothing missing

- Path traversal — `path.join` only takes constants/`process.env.HOME`; no `fs.readFile` takes tool input.
- Process spawning — only `inspect.tool.ts` uses `execFile` with arg array (already covered in prior cycle).
- HTTPS scheme on attachment URLs — covered by SSRF check in `http-client.ts:231-250`.
- Test-mock import leaks into prod code — clean.
- Insecure randomness for security-relevant IDs — none found (Math.random only used in pagination keys, not auth).

---

## Next step

Decide per-finding whether to file, expand, or skip. Then file approved items as new beads (mirroring the existing 2026-05-16 cohort's title/description style) and commit the JSONL update.
