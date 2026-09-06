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

## Note on the impeccable engine

`impeccable/scripts/impeccable` is a POSIX shell launcher, not the engine itself. It
looks for a platform binary at `scripts/bin/<os>-<arch>/impeccable`, then falls back to
`$IMPECCABLE_BIN`, `~/.impeccable/bin/`, a version-pinned cache, and finally `PATH`. No
binary is vendored here, so if none of those resolve, the launcher tries to download one
from the upstream GitHub releases.

The skill's written guidance — `SKILL.md` and its `reference/` documents — is what
loads into context and works with no binary present. Only the automated check verbs
(the hook pass, `live` browser mode) require the engine.
