# dsh-flash-net-mon — mirroring, releases and listing

Three procedures that are not part of writing code: bootstrapping and running the GitHub
mirror, cutting a release with its tarball, and getting the plugin onto dsh-market. Kept in
one file because all three are things you need occasionally and must get exactly right.

---

## The release gates — ask first, both times

**A release is never cut on the agent's own initiative.** Two gates, each one the
maintainer's decision:

| Gate | When | What to do |
|---|---|---|
| **1. The version** | Before touching `package.json`'s `version` | Stop. Say what is ready, name the version you would choose and why, and wait. |
| **2. The release** | Before `pnpm pack`, the tag, the push, or the GitHub Release | Ask again. Gate 1's approval does **not** carry over. |

A clean diff is not approval: "the work is done and every check passes" describes the tree,
not a decision about the tree. Once the version is bumped and a tag is pushed, none of it can
be taken back — so gate 2 sits in front of `pnpm pack`, the tag and the Release.

---

## Repository sync

**Gitee is authoritative; GitHub is a mirror of it.**

| Repository | Role | How it receives commits |
|---|---|---|
| `gitee.com/lenin.guo/dsh-flash-net-mon` | **Authoritative** | `git push` — the only remote configured (`origin`) |
| `github.com/tcgbp/dsh-flash-net-mon` | Mirror | `.github/workflows/sync-from-gitee.yml` |

No `github` remote is configured locally, deliberately — the same reason dock-flash has
none: **github.com is intermittently unreachable from this machine** (connection resets or
long connect timeouts), so a dual-push succeeds unpredictably, one repository takes the
commit while the other rejects it, and the two then sit silently divergent. The blocking is
host-specific rather than total: measured from here, `api.github.com` answers `HTTP 200`
while `raw.githubusercontent.com` resets the connection in the same minute. **The API is the
tool to reach for when the mirror looks stale; `git` is not.**

Both details of the workflow are load-bearing and must not be "simplified":

- It uses explicit refspecs (`refs/heads/*:refs/heads/*`), **not** `git push --mirror`.
  `--mirror` deletes refs the source lacks, which would delete the workflow file itself from
  the default branch whenever that file is the only commit GitHub holds that Gitee lacks —
  silently stopping every future scheduled run. The trade-off is accepted: a branch or tag
  deleted on Gitee is **not** deleted on GitHub.
- The workflow file is committed **to Gitee as well**. After a mirror push GitHub's default
  branch is exactly Gitee's tree, so anything living only on GitHub is wiped.

### Bootstrap — one time, before the workflow can run at all

A workflow runs on GitHub's runners, so it must already exist **on GitHub**. It cannot get
there through itself. As of 2026-10-04 `github.com/tcgbp/dsh-flash-net-mon` returns **404**
through `api.github.com` — the repository does not exist yet, so this has never been done.

1. Create an **empty public** repository `tcgbp/dsh-flash-net-mon` on GitHub. Do not add a
   README, `.gitignore` or licence: the mirror force-pushes every branch, so anything
   GitHub creates is overwritten anyway.
2. Put `.github/workflows/sync-from-gitee.yml` on its default branch. The GitHub web UI
   ("Add file → Create new file") is the simple route; through `api.github.com` — the host
   that is actually reachable from here — the Contents API does it in one call:
   ```sh
   tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
   node -e '
     const fs=require("fs");
     fs.writeFileSync("wf.json", JSON.stringify({
       message: "ci: bootstrap the Gitee mirror workflow",
       branch: "master",
       content: fs.readFileSync(".github/workflows/sync-from-gitee.yml").toString("base64"),
     }))'
   curl -sS -X PUT -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/tcgbp/dsh-flash-net-mon/contents/.github/workflows/sync-from-gitee.yml \
     -d @wf.json
   rm -f wf.json
   ```
   The Contents API creates the file, and on a repository with no commits it creates the
   first commit on the branch named there. The credential must carry the **`workflow`**
   scope — GitHub refuses to create or update a file under `.github/workflows/` without it
   (the Git Credential Manager entry for `github.com` normally has it). If the call is
   rejected for any other reason, use the web UI: it is a one-time step either way.
3. Add the **`dsh-plugin`** topic to the repository (Settings → Topics). The registry
   requires it.
4. Dispatch the workflow once, and confirm the mirror actually ran:
   ```sh
   tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
   curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $tok" \
     https://api.github.com/repos/tcgbp/dsh-flash-net-mon/actions/workflows/sync-from-gitee.yml/dispatches \
     -d '{"ref":"master"}'
   ```
   `204` means the run is queued and it settles in well under a minute. Never echo the
   token or let it reach a log or a file: keep it in a variable for the single call, as
   above. And write scratch files inside the repository, not in `/tmp`: this is Git for
   Windows, where bash's `/tmp` is the Windows temp directory but Node resolves a literal
   `/tmp` against the current drive (`C:\tmp`).
5. Verify through the API, because `git ls-remote` needs the host that is often blocked:
   compare `commit.tree.sha` from `/repos/tcgbp/dsh-flash-net-mon/commits/master` against the
   local `git rev-parse master^{tree}`. Matching **tree** hashes prove the two repositories
   hold identical content; matching *commit* hashes already imply it, so the tree comparison
   is what settles it when the hashes differ.

Gitee's built-in **仓库镜像管理** push mirror is not the mechanism in use — it never
delivered a commit for the sibling repository. Do not re-enable it: a second, unverified
mirror racing this workflow is how the two repositories drift apart again.

GitHub disables scheduled workflows after roughly 60 days without repository activity. If
the mirror looks stale, check the Actions tab first, then dispatch it by hand.

---

## Cutting a release

The runbook, to be run **after both gates are answered**. Which number to use: patch for a
bug fix, internal refactor, docs or metadata; minor for anything additive a third party can
observe (a new field, switch, route or service); major for anything removed or renamed.
**Never renumber a released version** — a published tag and Release cannot be recalled.

```sh
# 1. Version — ONE place in this package: package.json "version".
#    Unlike dock-flash there is no CLIENT_VERSION in lib/client.js; the browser half
#    reads the version from the settings namespace only.

# 2. If src/index.ts changed, rebuild and commit dist/ in the same commit.
pnpm run build && pnpm run typecheck

# 3. Commit, push to Gitee (the authoritative remote), then mirror and verify (above).
git push origin master

# 4. Build the release artifact. `pnpm pack` writes dsh-flash-net-mon-<version>.tgz; the
#    Release asset MUST be named dsh-flash-net-mon.tgz (version-free), because the
#    registry entry points at releases/latest/download/dsh-flash-net-mon.tgz — see
#    "Why the asset name has no version" below.
pnpm pack && mv dsh-flash-net-mon-<version>.tgz dsh-flash-net-mon.tgz

# 5. Tag and push it, then mirror AGAIN — a tag needs its own dispatch.
#    The ANNOTATED tag's message may be a summary; the RELEASE TITLE may not:
#    it is the bare version, "v<version>", and nothing else.
git tag -a v<version> -m "<summary>"
git push origin v<version>

# 6. Create the Release on GitHub and upload the asset (snippets below), then verify.
```

**Why the asset name has no version.** `releases/latest/download/` resolves `latest` at
request time but takes the **filename literally**. An asset named
`dsh-flash-net-mon-0.1.0.tgz` would satisfy the registry entry on the day it is submitted
and 404 the moment the next release is cut — quietly, and noticed by nobody. Keeping the
asset name version-free means publishing a new Release moves the URL by itself, so the
registry entry needs no edit and no pull request per release.

**The tarball is gitignored on purpose** (`*.tgz` in `.gitignore`), so it can never be
committed: a stale tarball in the tree is how a release ships the previous build, and the
artifact is reproducible from the tagged commit at any time. Nothing else needs editing per
release — the registry entry points at `releases/latest`.

### Creating the Release and uploading the asset

Both go through `api.github.com` with the same credential the mirror dispatch uses — the one
host that answers reliably from here. Write the JSON body to a file and pass it with
`-d @file`: an inline heredoc is easy to get subtly wrong, and creating a Release is not
idempotent.

```sh
tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')

# The tag must already exist on GitHub (step 5), target_commitish is master.
node -e '
  const fs=require("fs");
  fs.writeFileSync("release.json", JSON.stringify({
    tag_name: "v<version>",
    target_commitish: "master",
    name: "v<version>",              // the bare version, nothing else
    body: "<short summary — there is no CHANGELOG.md in this repo>"
  }))'
curl -sS -X POST -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/tcgbp/dsh-flash-net-mon/releases -d @release.json
#   -> note the returned "id"

# Upload the asset. Content-Type must be application/gzip, and ?name= is what the
# registry URL depends on.
curl -sS -X POST -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/gzip" --data-binary @dsh-flash-net-mon.tgz \
  "https://uploads.github.com/repos/tcgbp/dsh-flash-net-mon/releases/<id>/assets?name=dsh-flash-net-mon.tgz"

rm -f release.json
```

**Always verify the release end to end**, because none of it errors loudly:

- `/repos/tcgbp/dsh-flash-net-mon/releases/latest` reports the expected tag and lists the
  asset; the upload response carries a `digest` (`sha256:…`) and a `size` — check both.
- Download the asset back through `api.github.com` (`Accept: application/octet-stream`, by
  asset id) and `cmp` it against the local build. Byte equality is the only proof the upload
  was not truncated.
- Do not verify by fetching `releases/latest/download/...` from a browser on this machine:
  `github.com` is intermittently unreachable here while `api.github.com` is not, so a
  connection reset says nothing about whether the asset is good.

---

## Listing on dsh-market

dsh-market reads its catalog from the curated **awesome-dsh-plugin** registry, so being
installable from a Release is not the same as being listed. The entry to submit is written
and validated:

**[docs/tcgbp__dsh-flash-net-mon.yml](tcgbp__dsh-flash-net-mon.yml)**

Copy it to `data/plugins/tcgbp__dsh-flash-net-mon.yml` in a fork of
`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin` and open a PR. One file is the
whole submission; the two READMEs there are generated from these entries and must not be
hand-edited.

How it was verified locally on 2026-10-04 — worth repeating after any edit, because every
rule below fails as a CI error rather than as something you notice:

```sh
git clone --depth 1 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin /tmp/awesome-dsh-plugin
cd /tmp/awesome-dsh-plugin && npm i js-yaml --no-save
cp <this-repo>/docs/tcgbp__dsh-flash-net-mon.yml data/plugins/
node -e "import('./scripts/lib/entries.mjs').then(m=>{const p=m.validateEntries(m.readEntries());console.log(p.length?p.join('\n'):'0 problems')})"
node scripts/generate-readme.mjs   # adds exactly one line to README.md and README.zh.md
```

The rules the registry's `scripts/lib/entries.mjs::validateEntries` enforces: only
`url`/`name`/`category`/`description`/`tarball` may appear (no `npm:` key — the npm mapping
is resolved from the repository); the filename must equal `slugFor(url)`; a `name` written
as `owner/repo` must match the `url`; `category` must be one of its `CAT_IDS`; `description.en`
is required and must be a single line; and `tarball` must be `https` on GitHub release
hosting and end in `.tgz`/`.tar.gz`. A description containing `: ` **must be quoted**, or
YAML parses it as a nested mapping key.

**Prerequisites that are not satisfied yet** (state checked 2026-10-04):

| Requirement | State |
|---|---|
| `github.com/tcgbp/dsh-flash-net-mon` exists | ❌ 404 — bootstrap the mirror first |
| Repository carries the `dsh-plugin` topic | ❌ add it when the repo is created |
| A Release serves `dsh-flash-net-mon.tgz` | ❌ cut the first release |
| Repository is at least 1 day old | ⏳ automatic; the gate re-runs itself every 6 hours and clears on its own |
| `dsh.bundle` manifest + `cordis.patch.yml` | ✅ both present |
| Real working code; `@deepseek-ai/*` as peer dependencies | ✅ |

Submitting before those are true would hand a reviewer a 404 `url` and a 404 `tarball`, so
the entry sits here until the mirror is live.

**Publishing to npm is optional** and only changes the install experience (a prebuilt
install skips the build-approval step). The registry maps the npm package back to the listed
repository by matching the published package's own `repository` field against it, so such a
package's `repository` must point at `github.com/tcgbp/dsh-flash-net-mon` — a Gitee-only URL
does not match, and the mapping is then simply left absent. Listing does not depend on npm.
