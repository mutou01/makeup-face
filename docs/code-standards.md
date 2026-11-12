# Code standards

These are the rules a reviewer checks. Every rule is written so that a reviewer
can point at a specific thing in a diff and say whether it holds — a rule that
can only be agreed with is not a rule, it is a preference.

A change that misses one gets a comment naming it. Rules arrive here from
[LESSONS.md](../LESSONS.md) after a review has found them on three or more
separate days; they are earned, not decided. How to describe and review a
change to a subsystem is in the [subsystem references](subsystems/README.md).

## What a change contains

| Rule                                                       | What a reviewer looks at                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A change does only what its goal needs.                    | The diff for edits that the stated goal does not require. Unrelated tidying belongs in its own change, where it can be reviewed and reverted on its own.                                                                                                                  |
| A fix reaches every sibling of the bug.                    | Search for the same pattern: every command, branch, guard of the same shape and caller of a changed predicate gets the fix in the same change. A fix that covers only the case in the report is not finished.                                                             |
| A change re-derives everything built on what it changes.   | Every place that reads the changed value, depends on the changed ordering, or caches the old answer. Ask what else assumed the old behaviour and was not updated.                                                                                                         |
| A failed read, parse or hash means "unknown".              | That it never means "empty", "none" or "equal". Keep what was read before; copy a file that does not parse aside before writing over it; fix the shared reader rather than writing a strict one beside it. A list that guards access fails closed when it cannot be read. |
| Nothing that can block runs under a lock its reader needs. | Every call made while a lock is held, for one that waits on I/O, a subprocess or another lock the reader also takes.                                                                                                                                                      |
| A default never overrides a value the user set.            | That a migration or startup path writing a setting names the users who set it themselves, and leaves their value alone — or says in the release notes why not.                                                                                                            |
| Checks cover the edges the change touches.                 | The boundary values the new code branches on, and what happens one step outside each.                                                                                                                                                                                     |

## Tests

| Rule                                                         | What a reviewer looks at                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A fix comes with a test that fails without it.               | Put the old code back and run the test; it must fail, with a real failure that names the behaviour. A compile error or a skipped test does not count. The change says what it failed with. |
| A test never reaches the network.                            | Where its requests go. A remote page or API is served from a local fixture, recorded from the real one. A dependency comes from a lock file, not from whatever the registry serves today.  |
| Tests use real inputs.                                       | Whether a test feeds the code what it will actually receive — real payloads, real files, real encoding — or a convenient simplification that hides the bug.                                |
| Tests check behaviour, not implementation.                   | That a test breaks when the behaviour breaks, not when a function is renamed or an internal is reordered. A test named for a guarantee must go red when that guarantee is removed by hand. |
| A test that fails on the main branch is a bug to fix now.    | That a failure is reproduced on a freshly fetched main branch, naming the commit, before it is called pre-existing. A red test is not inherited; it is either fixed or filed, now.         |
| Tests stay out of the real machine.                          | That a test uses a temporary home directory and pinned caches, and never reads or writes a real config, credential or user file.                                                           |
| Whatever a test starts ends when the test does.              | Processes, servers, temp directories and background workers, on the failure path as well as the success path.                                                                              |
| A timing test leaves room on both sides.                     | That a test does not bound itself by wall-clock time it cannot control, and does not assert a duration it will eventually exceed on a loaded machine.                                      |
| Run the whole suite, not the packages you think you touched. | The command that was run. Guards live in packages that a change did not touch; those are exactly the ones it can break.                                                                    |

## Rules that can be a test

A rule that can be checked mechanically is checked mechanically, and the prose
here points at the test rather than replacing it. A written rule is read once
and then forgotten; a failing test is not.

When a convention can be expressed as an assertion, write the assertion:

- a folder or setting that must be listed somewhere, and a test that fails when
  it is not;
- a call that must never be made from a given package;
- a file that must stay under a size budget, or a module that must not grow a
  dependency;
- a string a user can see that must go through translation, and a test that
  fails on a literal;
- a marker or registration that must accompany a new entry of some kind.

The test is the rule. The sentence in this document exists so that whoever
trips over it knows why it is there.

## Acceptance criteria

A change is merged only when it shows each of the following. **Say which ones
were run and what they printed. A check that was not run is listed as not run,
never left out** — a missing line reads as a passing one, which is how an
unverified change gets merged.

1. **A test that fails without the change.** Put the old code back and run the
   new test. It must fail, naming the behaviour, not the syntax.

2. **Tests in a sandbox.** The suite runs against a temporary home directory
   with its caches pinned. It does not touch live configuration, credentials or
   user data on the machine it runs on.

3. **The gate.** `npm run verify` passes, from a clean checkout, at the commit
   being reviewed. Not the packages you think you touched — the whole suite.

4. **The build.** Whatever the project ships builds, in the configurations it
   ships in. If it targets more than one platform or runtime version, say which
   ones were built and which were not.

5. **Real use where it is possible.** The change works against the real thing,
   not only against a fixture. If a real check is not possible, say so — what
   was not tried with the real thing is not built on and is not described to
   users as working.

6. **The documentation.** The owning subsystem reference, the manual, and the
   examples are still true. A link that no longer resolves is a failure, not a
   nitpick.

## Reviewing a change

- **Run it.** A review is not a reading. Fetch the change, run it, run the
  gate.
- **Break it on purpose.** Revert the fix, or break the code it guards in
  several ways, and check that the new tests catch each break. A test that
  catches nothing is worse than no test, because it reads like coverage.
- **Follow the whole path.** Trace callers and state transitions past the
  changed lines. The changed lines are the part the author already thought
  about.
- **Classify narrowly.** A bug is what the code does wrong, not what a caller
  does with it, and not what the report guessed.
- **Do not reverse a deliberate decision.** If a past change looks wrong, find
  out why it was made before changing it back. If the reason is gone, say so in
  the change.
- **Docs match the source.** A reference is checked against the code it links,
  and every link resolves.
- **Report what was not checked.** The same rule as the acceptance criteria: a
  check that was not run is listed as not run.

## Documentation

Update the owning reference under [docs/subsystems/](subsystems/README.md) in
the same change when the change alters a documented responsibility, interface,
state transition, runtime path, compatibility rule or failure behaviour. An
internal refactor that preserves those contracts needs no prose change.

Keep each fact in one place and link to it. Link to files and named symbols
rather than copying code that changes often. Explain what a signature cannot:
what a field means, what its absence means, what must hold before a call.

Document current behaviour separately from proposed changes; the proposal
belongs in its issue, not in the reference.

## Project conventions

<!-- scripts/init writes the block for this project's stack between the two
     markers below. Edit it freely afterwards — it is yours now; the markers
     are only there so the generated text has somewhere to land. -->
<!-- stack:begin -->

### Go

Starting points, taken from a Go project that runs this way. Edit them.

- Write `any`, not `interface{}`.
- A comment says what the code is for, in a sentence or two. Name functions
  instead of giving line numbers, which go stale.
- Wrap errors with what was being attempted — `fmt.Errorf("reading config: %w",
err)` — and branch on `errors.Is` / `errors.As`, never on the message text.
  A caller that matches a string breaks the next time the message is improved.
- Read environment variables that name a folder through a helper that rejects a
  relative path, so a typo cannot quietly resolve to the working directory.
- `go vet ./...` checks Go; `tsc --noEmit` checks the TypeScript frontend. Keep
  both in `npm run verify`. Build the frontend before commands that load `go:embed`.
- Table tests name each case for what it is (`"expired token is rejected"`),
  not for its position.
- A test that must not touch the real machine sets `t.Setenv("HOME", t.TempDir())`
  (and the equivalent on Windows) rather than relying on the developer's setup.
- A module with no packages yet fails `go vet` and `go test` with "no packages
  to vet". That is the gate declining to report success on an empty tree, not a
  misconfiguration — it goes green with your first package.

<!-- stack:end -->

## Commits

A commit message names the area it changes, then says what the user now sees,
written as plain behaviour:

```
gateway: a 429 that says the balance is spent is out of credit, not a rate limit
```

Give the issue number or the reporter when there is one. The body says how it
was verified, and which test fails without the change — the same evidence the
acceptance criteria ask for, in the place a later reader will look for it.

One commit, one goal. A fix found on the way goes in its own commit, where it
can be reviewed and reverted on its own.
