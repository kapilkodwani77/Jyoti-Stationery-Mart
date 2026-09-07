# Vendored skills

Skills committed into this repository rather than installed locally.

Skills installed on a developer's own machine (`~/.claude/skills`, `~/.claude/plugins`)
do not reach Claude Code sessions that run in a remote container — those start from a
fresh clone with an empty `~/.claude`. Anything committed here travels to every
session, local or remote. That is the reason these live in the repo.

## Sources

| Skill(s) | Upstream | Commit | Licence |
|---|---|---|---|
| `banner-design`, `brand`, `design`, `design-system`, `slides`, `ui-styling`, `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `4aad058` | MIT |
| `impeccable` (engine v0.1.2) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `720628f` | Apache 2.0 |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `063bee9` | MIT (declared in that repo's README; it ships no LICENSE file) |
| `frontend-design` | [anthropics/claude-code](https://github.com/anthropics/claude-code) `plugins/frontend-design` | — | see `frontend-design/LICENSE.txt` |

Licence texts are kept alongside the skills they cover: `ui-ux-pro-max/LICENSE` (MIT,
covers all seven skills from that repo) and `impeccable/LICENSE` (Apache 2.0).

## Deliberately not installed

Both upstream repos ship more than the skill directories. These parts were left out:

- **`impeccable`'s `.claude/settings.json`** — registers `PostToolUse` and `Stop` hooks
  that execute `impeccable/scripts/impeccable` on every Edit/Write and at the end of
  every turn. Automatically running a command on each edit is a separate decision from
  installing the skill's guidance, so it is not enabled here. To turn it on, copy those
  hook entries into the repo's `.claude/settings.json`.
- **`impeccable`'s `.claude/agents/*.md`** — four subagent definitions
  (`asset-producer`, `documenter`, `finish-reviewer`, `manual-edit-applier`). Not
  installed; they add new subagent types.

## Note on web-design-guidelines

Upstream, this skill is a 40-line wrapper carrying no rules of its own. It
fetches them at review time from:

    https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

That host answered 200 when the skill was installed, but `skills.sh` is
already blocked from this container, so the same can happen here — and the
failure would be silent, leaving a review with no rules to check against.

So `reference/command.md` holds a pinned copy of that file (7760 bytes,
md5 `c65ffa0c6d0c5f20ba37f6b66c078b39`, 103 rules), and one paragraph was
added to `SKILL.md` pointing at it as a fallback. That paragraph is the only
divergence from upstream; the rest of the file is verbatim. The live fetch is
still preferred, since the pinned copy is a snapshot and will age.

## Note on the impeccable engine

`impeccable/scripts/impeccable` is a POSIX shell launcher, not the engine itself. It
looks for a platform binary at `scripts/bin/<os>-<arch>/impeccable`, then falls back to
`$IMPECCABLE_BIN`, `~/.impeccable/bin/`, a version-pinned cache, and finally `PATH`. No
binary is vendored here, so if none of those resolve, the launcher tries to download one
from the upstream GitHub releases.

The skill's written guidance — `SKILL.md` and its `reference/` documents — is what
loads into context and works with no binary present. Only the automated check verbs
(the hook pass, `live` browser mode) require the engine.
