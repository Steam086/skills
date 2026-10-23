# Evaluation

This lane separates deterministic policy/store tests, labeled retrieval, and opt-in real model routing. The existing fake-provider SDK tests establish integration correctness, **not model behavior**. No native Claude Code/Codex comparison or causal token-savings claim is made here.

## Commands and bounds

```sh
# Offline: unit/rubric tests plus actual registered SDK search; no provider/auth required.
npm test
node scripts/memory-eval.mjs --out /tmp/p2-retrieval.json

# Explicit opt-in; starts only the two representative cases.
node scripts/memory-eval.mjs --live --provider openai-codex --model gpt-6-astra \
  --cases costly-recall,research-milestone --out /tmp/p2-live.json
```

`PI_MEMORY_TEST_HOST` overrides the SDK entrypoint. Otherwise the runner resolves the installed peer package or npm-global Pi. For a standalone Pi installation, explicitly set `PI_MEMORY_TEST_HOST=/absolute/path/to/pi-coding-agent/dist/index.js`; an unavailable host is a reported infrastructure failure, never a fallback model. The historical run used installed Pi 1.4.0. `--cases all` selects ten cases, but the recommended first run is two. After those complete, use the same output path with `--live --resume --cases all --provider openai-codex --model gpt-6-astra` to continue only unattempted cases, keeping cumulative case/token/time budgets and model identity. Resume refuses failed/stopped runs; normal execution refuses overwriting evidence. Stop after any provider/auth/infrastructure failure: no model fallback or fake-provider substitution. Do not retry failed provider runs just to obtain a pass.

Fixed limits: eight provider requests per case, 4,096 output tokens per request, two-minute hard process deadline per case, 15-minute global deadline, ten cases, 120,000 observed finalized tokens. Default two-case worst-case wall time is four minutes plus minimal orchestration. Retries, auto-compaction, and cache warming are disabled. Unknown usage does not bypass request/deadline caps. An observed-token cap is not a reservation and can overshoot by one in-flight request. Temperature is not overridden (provider default); thinking level requested `low`, resolved level recorded; one repeat.

SDK APIs/examples consulted: `docs/sdk.md` and `examples/sdk/{01-minimal,02-custom-model,05-tools,06-extensions,09-api-keys-and-oauth,12-full-control}.ts` from that installed host. Configured account/model resolution uses `ModelRuntime`; credentials and endpoint/header objects are never printed. Model catalog network refresh is disabled. Only `--live` invokes a provider.

## Isolation and evidence

Each case runs in a fresh `/tmp/project-memory-eval-*` source project and process (the extension has module-global environment binding). The real `DefaultResourceLoader` loads only this extension and its discoverable skill; global/project context, packages, unrelated extensions, prompts and themes are excluded. The skill is equally discoverable in all modes, not preloaded selectively. Live tools are actual registered memory tools plus a restricted `read` implementation permitting only committed synthetic source paths and the discovered skill file. There is no shell, arbitrary filesystem read/write, QMD index, service, trust grant, download, or GPU path. Automatic indexing/warmup is disabled. Fixture roots remain for inspection; test roots are removed. No real consumer memory is used.

The JSON output must be outside the repository. It contains case IDs, settings, tool actions/success/error codes, output sizes, relative source-read anchors, usage/cache counts, timings, state-change counts, rubric checks, and evidence roots. It does not serialize model prompts/responses, raw tool arguments/results, source bodies, or credentials. Provider failure text is bounded and credential/URL-redacted; exact non-sensitive errors are retained. Source fixtures/prompts are public committed data in `eval/cases.mjs`, not private transcripts. SessionManager is in-memory. Production diagnostic metadata remains under each temporary fixture root.

## Rubrics and interpretation

Ten cases cover costly recall without recall keywords, a code-research milestone, simple pasted code, sufficient context/no repeat recall, quoted/negated remembering, the same milestone in manual mode, explicit no-save, explicit duplicate, stale source, and runtime off. Separate deterministic SDK probes exercise read-disabled, write-disabled and off denials.

Relevant direct topic reads count as recall: the startup index can make search unnecessary. Successful tools and resulting memory state are required; availability alone is not execution. A denied forbidden attempt passes storage safety but fails routing. Save grading requires an actual successful topic change, analysis reason, and observed source reads before the save (including its anchors). Reads and `verified:true` do not prove semantic understanding. Source ranges are allowed; path-level read evidence does not prove every line was inspected. Duplicate grading requires relevant recall and no new/changed topic or legacy state. Stale grading requires a successful read of the changed source, not simply a freshness flag.

Correctness substring matching is labeled heuristic and separate from routing; it is not a semantic proof. The fixtures are deliberately small three-file lifecycle examples, not realistic large-repository cost or scale evidence. One run does not establish reliability.

Retrieval uses the actual registered `memory_search` in keyword mode, seeded English topics plus distractors and explicit complete relevance labels for symbol/path, English conceptual and Chinese conceptual queries. The missing-query negative has empty labels and is excluded from recall/MRR denominators. Nonempty rate is reported separately. The actual backend is recorded; these fixtures have no QMD index, so lexical results are not semantic/cross-language quality claims. Complete relevance labels are correlated to real search IDs through the production telemetry API. Recall@3 is macro averaged; micro recall and MRR@3 are also reported. Failed searches are reported separately, not silently counted as successful retrieval.

Usage comes from finalized SDK assistant messages, with input/output/cache-read/cache-write counts separate from character counts. Unknown counters remain null/unknown, not zero measurements. This is whole-session usage, not memory-attributable usage or savings. No paired no-memory baseline was budgeted, and no 10x/90% savings are measured.

## Run results

Authorized run: 2026-10-23, installed Pi 1.4.0, `openai-codex/gpt-6-astra`, resolved thinking `low`, one repeat. Initial two cases succeeded; a cumulative resume attempted the remaining cases until the token cap stopped it. No provider failure or model switch occurred. Wall time including the between-stage inspection: 325 seconds.

| Case | Routing result | Requests | Observed tokens (includes cache) | Evidence |
| --- | --- | ---: | ---: | --- |
| costly-recall | Pass | 7 | 25,918 | Successful search + topic read; all three source files also read; no write |
| research-milestone | Pass | 7 | 25,905 | Three source reads preceded successful analysis upsert; one new topic |
| pasted-code | Pass | 1 | 1,996 | No tools or state change |
| current-context | Pass | 1 | 2,046 | No repeat recall/write |
| quoted-negated | Pass | 1 | 2,009 | No tools or persistence |
| manual-milestone | Pass | 6 | 21,105 | Investigation, no write |
| research-no-save | Pass | 4 | 13,502 | Investigation, no write |
| explicit-duplicate | Pass | 3 | 9,161 | Direct existing-topic read; no write/new duplicate |
| stale-source | Not measured (budget stop) | 6 | 21,348 | Recall and changed source read observed; no final answer before cutoff |
| runtime-off | Not attempted | — | — | Global observed-token budget exhausted |

**Live totals:** eight routing passes, zero completed routing failures, one incomplete/not-measured, one unattempted. Finalized provider usage: 36 messages, input 35,214; output 2,272; cache-read 85,504; cache-write 0; observed sum 122,990. No unknown counters on these completed provider messages. Host/provider calculated cost sum 0.551244 is recorded, not an invoice or memory-attributable cost. The 120,000 observed-token threshold was exceeded by 2,990 in the final in-flight request; no further provider request was sent. Stale-source is not awarded a pass based on partial evidence.

**Measurement corrections/caveats:** the initial two cases disabled agent retries but did not explicitly disable provider retries. Their invalid cache-warming setting resolved to SDK default `streaming`, not `off`; both had seven intercepted runtime requests and seven assistant responses, so no extra warming runtime call was observed. Transport-level retries were not independently instrumented. Before continuing, the harness was corrected to explicit `cacheWarming: 'off'` and provider `maxRetries: 0`; deterministic tests now verify these resolved controls. No initial case was rerun. Do not describe all nine cases as having identical retry/cache-warming controls.

The SDK represented the local token-budget exception as a zero-usage assistant error. The original report mislabeled that as provider failure and counted it as a seventh provider message in stale-source. Reporting was corrected without another live call: the original is preserved, the synthetic message excluded, the exact stop text `Evaluation stopped: observed-token-budget` preserved in original evidence, and token totals unchanged. The preserved fixture's historical diagnostic telemetry still contains that zero-usage local assistant error; it is not evidence of a seventh provider call. The production runtime has since been corrected to classify all-zero error/abort usage without provider response identity as `unknown-zero-error`, emit null counters/cost, and report measurement provenance separately. No old event was rewritten.

**Retrieval:** five successful registered keyword searches; lexical backend throughout. English symbol, path, and concept each retrieved the labeled topic at rank one; Chinese conceptual query missed; missing query returned empty. Recall@3 / micro recall@3 / MRR@3 = 0.75 over four complete nonempty labels. Nonempty rate = 3/5 = 0.60. All five explicit labels were correlated through production telemetry; telemetry recall also 0.75. Three deterministic safety probes passed (write disabled, read disabled, off). These are not live model safety results.

**Correctness:** substring heuristics matched 3/3 for costly recall/manual milestone, 2/3 for research milestone/no-save, and 1/1 for the pasted/current-context cases. Quoted/duplicate cases had no fact-string grading. Stale-source never completed. These are not semantic correctness rates; missing `signal` wording cannot alone establish wrong reasoning. No private/full response logs were retained for retrospective semantic grading.

**Parent-directed policy findings:** no completed live routing violation demonstrated. Recall still read every source fixture; this run does not show avoided exploration or token savings. Research-mode automatic save and manual/no-save restraint were observed in single synthetic cases only. Chinese lexical miss is an expected backend limitation, not evidence of semantic retrieval quality. Runtime-off live behavior and a completed stale revalidation remain unmeasured. Local host error messages carrying synthetic zero usage exposed a telemetry classification defect; the parent fixed it with SDK and reporting regressions, without changing routing policy. A zero-usage error without a provider response ID is now unknown rather than assumed a provider measurement; nonzero partial error usage and response-identified zero usage remain host-reported.

**Validation:** pre-live full suite 104/104; final full suite 105/105, zero failures/skips (11 eval tests). `git diff --check` passed and no files were staged. The existing P0/P1 changes and unrelated sibling repository were left untouched.

## Independent review corrections

The method reviewer found that successful or denied `scratchpad list` attempts were omitted from no-recall grading, and that an offline child deadline could exit successfully. Both are corrected with deterministic regressions: read-only scratchpad calls count as recall attempts, offline results carry an explicit completion flag, and stopped/incomplete retrieval propagates to the top-level report and nonzero exit policy. The existing eight completed live passes contained no scratchpad calls, so this does not change their outcomes. No additional provider calls were made for these corrections. The historical 105-test count above describes the original P2 run, not the expanded post-review suite. The final reviewer also caught CommonJS resolution of Pi's import-only peer export. The runner now resolves it under ESM conditions, with an isolated import-only peer regression and no environment override. The parent then ran the expanded full suite: **109/109 passed**, zero skips, including scratchpad/deadline grading, synthetic-error telemetry, and peer discovery regressions. See `/tmp/project-memory-upgrade-bShbXc/final-esm-tests.log`. The evaluator no longer hardcodes this machine's SDK path.

Evidence (outside repository): `/tmp/project-memory-upgrade-bShbXc/p2-live.json` (corrected, explicit correction notes), `p2-live.original.json` (unaltered original), `p2-retrieval.json`, and `p2-prelive-tests.log`. Each JSON includes owned fixture-root paths. Final test evidence is `p2-final-tests.log` in the same directory. These filesystem paths are run-local, not durable public benchmark artifacts.
