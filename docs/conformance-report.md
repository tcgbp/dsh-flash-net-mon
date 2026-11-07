# DSH standards check — dsh-flash-net-mon@0.3.3

> ⚠️ 本次未执行插件代码（默认安全模式：`--entry-claim static --no-exec`；运行时检查记为 not-run，不是 PASS）。
> host 版本 `0.2.2-rc.1`（来源：flag）；anchor.source=host。

**Conclusion:** ds-c/package · runtime 0.2.2-rc.1 host · blocking 0 · hygiene 1 · partial 6 · not checked 2/14

- Status: **pass** (exit 0)
- Level: DS-C (package)
- Anchor: dsh=0.2.2-rc.1 (source=host)
- Coverage: 12/14 checks evaluated · declared fields 3/5

## Priority fixes (up to 3)

1. **WARN C-11.5** (DSC-11) — 删掉未使用的 capability，或补上实际调用；动态触发无法静态确认时在 README 说明。
   - Why: 过度声明会误导用户，也会让权限面看起来比实际大。
   - Docs: https://github.com/PerryLink/dsh-plugin-guide/blob/v0.5.0/docs/entry.md#capability-triggers

## Blocking (FAIL) — 0

_None._

## Hygiene (WARN) — 1

| id | clause | result | coverage | reason |
|---|---|---|---|---|
| DSC-11 | C-11 | WARN | full | C-11.5: declared capability network:ingress was not observed statically \| C-11.5: declared capability fs:read was not observed statically \| C-11.5: declared capability fs:write was not observed statically [declaration,advisory] |

## Partly checked (static subset) — 6

| id | clause | result | coverage | reason |
|---|---|---|---|---|
| DSC-04 | C-4 | PASS | partial | static subset passed: entry/export/patch shape; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path> |
| DSC-05 | C-5 | PASS | partial | static subset passed: provide declarations enumerated; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path> |
| DSC-06 | C-6 | PASS | partial | static subset passed: no private-surface writes found; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path> |
| DSC-07 | C-7 | PASS | partial | static subset passed: teardown references enumerated; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path> |
| DSC-08 | C-8 | PASS | partial | static subset passed: restart references enumerated; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path> |
| DSC-09 | C-9 | PASS | partial | static subset passed: declaration cross-check; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path> |

## Not checked (NA / not-run / ERROR) — 2

| id | clause | result | coverage | reason |
|---|---|---|---|---|
| DSC-03 | C-3 | NA | not-run | install spec not supplied (package profile) |
| DSC-14 | C-14 | NA | not-run | entry static claim: no runtime evidence |

## Security (advisory)

- Status: **incomplete** · blocking 0 · warn 0 · advisory 0 · partial 3 · notRun 1
- DSC-22 NA — no registry metadata/attestation input; not-run
- Static clues only: this block is not a security proof, audit, or certification.

## Passed — 11

DSC-01, DSC-02, DSC-04, DSC-05, DSC-06, DSC-07, DSC-08, DSC-09, DSC-10, DSC-12, DSC-13

## Advice (non-blocking) — 1

- WARN C-11.5 (DSC-11): 删掉未使用的 capability，或补上实际调用；动态触发无法静态确认时在 README 说明。
  https://github.com/PerryLink/dsh-plugin-guide/blob/v0.5.0/docs/entry.md#capability-triggers

## What this report does not check

- DSC-03 (C-3): install spec not supplied (package profile)
  - enable: pass --install-spec <spec>, or --market-index <file> --plugin-name <name>
- DSC-14 (C-14): entry static claim: no runtime evidence
  - enable: pass --host <app-boot/lib/index.js> for bundle G0-G3, or --runtime <path> for a plugin; omit --no-exec and --entry-claim static
- DSC-04 (C-4): partial coverage — static subset passed: entry/export/patch shape; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path>
  - still needs: omit --no-exec; pass --treat-as-plugin --runtime <path> for L1-L3, and --host <dir> for bundle G0-G3
- DSC-05 (C-5): partial coverage — static subset passed: provide declarations enumerated; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path>
  - still needs: omit --no-exec; pass --treat-as-plugin --runtime <path> for L1-L3, and --host <dir> for bundle G0-G3
- DSC-06 (C-6): partial coverage — static subset passed: no private-surface writes found; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path>
  - still needs: omit --no-exec; pass --treat-as-plugin --runtime <path> for L1-L3, and --host <dir> for bundle G0-G3
- DSC-07 (C-7): partial coverage — static subset passed: teardown references enumerated; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path>
  - still needs: omit --no-exec; pass --treat-as-plugin --runtime <path> for L1-L3, and --host <dir> for bundle G0-G3
- DSC-08 (C-8): partial coverage — static subset passed: restart references enumerated; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path>
  - still needs: omit --no-exec; pass --treat-as-plugin --runtime <path> for L1-L3, and --host <dir> for bundle G0-G3
- DSC-09 (C-9): partial coverage — static subset passed: declaration cross-check; bundle G0-G3 needs --host <dir>; L1-L3 need --treat-as-plugin --runtime <path>
  - still needs: omit --no-exec; pass --treat-as-plugin --runtime <path> for L1-L3, and --host <dir> for bundle G0-G3
- Runtime execution beyond the checks listed above is not observed by this report.
- It does not certify, rank, audit security, or endorse the package.

---

Non-official report. This is not a certification, security audit, endorsement, or ranking. Hygiene warnings are not a clean pass; items under "Not checked" were not inspected.

