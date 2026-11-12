<!--
Copy this file to <subsystem-name>.md and fill it in. Delete any section that
genuinely does not apply, but read the reason for each one first — the sections
that feel unnecessary are usually the ones whose absence costs the most later.

Keep it about behaviour and contracts. Leave out anything a signature already
says, and link to source rather than pasting it: pasted code goes stale and
nobody notices.
-->

# <Subsystem name>

One or two sentences: what this is responsible for, and the single fact about
it that is hardest to work out from the source.

## Responsibilities and boundaries

What it is responsible for. Then what it is deliberately not responsible for —
the adjacent thing a reader would reasonably assume belongs here. Naming the
boundary is usually more useful than naming the responsibility.

## Source of truth

Which file, table, setting or record decides this subsystem's behaviour. Name
it explicitly: when this page and the code disagree, the reader needs to know
which one is wrong.

| Part   | Responsibility            | Source         |
| ------ | ------------------------- | -------------- |
| <part> | <what it decides or owns> | `path/to/file` |

Each cell in the last column is a relative Markdown link to the file, written
from this page's location (`../src/thing.go`). The row above is left as plain
text so that the link checker — which cannot tell an example from a broken
link — stays useful.

## Runtime paths

The paths that actually run, in the order they happen. Number them. A reader
should be able to follow one end to end without opening the source.

1. <trigger> → <what happens> → <where it ends up>
2. <the other path that matters, including the one that fails>

## State and transitions

What state this subsystem keeps, where it lives, and which transitions are
allowed. For each piece of state: who writes it, who reads it, what happens if
it is missing or unreadable, and whether it outlives a process.

If there is no state, say so — it is a fact worth knowing.

## Constraints and failure behaviour

What must hold before a call, what happens when it is called anyway, and what
the caller sees when something fails. Include the constraints that are easy to
break by accident: ordering requirements, limits, timeouts, and anything that
must not run under a lock.

## Verification

The commands that check this subsystem, copy-pasteable as they are. These are
the _targeted_ checks; the whole-suite gate is `make verify` at the project
root.

```sh
# <what this proves>
<command>
```

Name the test that exercises the behaviour you are most likely to break, so a
reader can run it before and after their change.

## Out of scope

Related behaviour that lives elsewhere, with a link. This is where a reader
lands when they arrived at the wrong page.
