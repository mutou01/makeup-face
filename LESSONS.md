<!-- reviewed-through: none — nothing reviewed yet -->

# Lessons from merged work

This file records what recently merged work got wrong, and the rule that would
have caught it. Read it before changing code.

Each lesson is a rule, then its evidence, then how many separate days a review
found it:

> **State the rule as an imperative, in one sentence.**
>
> - What went wrong: the change, what it broke, and the fix that landed. Name
>   commits, issues and reporters, so the evidence can be checked rather than
>   believed.
> - Seen 1× (2026-01-01).

`Seen` counts the _days_ a review found the same rule, not the times it
happened — three incidents in one afternoon is still one day. **A lesson seen
on 3 or more separate days moves into
[docs/code-standards.md](docs/code-standards.md)**, where it becomes a rule a
reviewer checks by name. The evidence stays here, under
[Moved to the code standards](#moved-to-the-code-standards).

Rules live here while they are still being earned. Moving one into the
standards is the point of this file: it keeps this log short enough to read
before every change, and keeps the standards backed by evidence rather than by
taste.

## How to maintain this

Review the work merged since the marker on line 1. For each thing that had to
be fixed again, that should not have merged, or that was verified too thinly,
append a rule and its evidence. If a rule already exists, add the evidence and
bump `Seen`. Then set the `reviewed-through` marker to the last commit you
reviewed, so the next review knows where to start.

If a rule has reached `Seen 3×`, move it into the standards and replace it here
with a line under [Moved to the code standards](#moved-to-the-code-standards).

An agent may propose a lesson and write the evidence. A human decides whether
it belongs, and decides every promotion into the standards.

## Format

<!-- This section shows the shape of an entry so the first real one has a model
     to copy. Delete it once you have written a lesson of your own. -->

> **Name the rule after the failure it prevents, not after the code it touches.**
>
> - A rule named after a function stops applying when the function is renamed;
>   one named after the failure keeps working. `abc1234` (#12) renamed a rule
>   from "`syncAll` must not run twice" to "a retry never repeats a write",
>   which then caught two more cases in the same package.
> - Seen 1× (2026-01-01).

## Verification

<!-- Rules about how a change is checked, and about what counts as evidence.
     Anything that reaches Seen 3× here becomes a row in the code standards. -->

## The user's own files and settings

<!-- Rules about not overwriting what someone set themselves, and about
     defaults staying out of the way. -->

## Tests

<!-- Rules about what a test has to do to count as proof. -->

## Concurrency and state

<!-- Rules about locks, ordering, retries, and anything that only fails under
     load or in a different order. -->

## Moved to the code standards

These were seen on three or more separate days. The rules and the review that
checks them are in [docs/code-standards.md](docs/code-standards.md). The
evidence stays here, so a rule can always be traced back to what earned it.

<!--
> **Rule text, as it now reads in the standards** (dates seen). What happened,
> and what the fix was.
-->
