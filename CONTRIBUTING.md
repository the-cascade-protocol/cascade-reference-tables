# Contributing to cascade-reference-tables

Thank you for helping. This repository holds the project's reference tables: the contract a table builder and its host
follow, the host, the builders of the open sources, and the feed apps read. It is a draft; no compatibility is promised
before a numbered v1. [`README.md`](README.md) says where to start for a builder, a host or an app, and
[`CLAUDE.md`](CLAUDE.md) holds the rules a change here follows; read it before you change a shape, a rule or a builder.

Report a security problem privately, by email to contact@cascadeprotocol.org, never in a public issue.

## Set up

You need Node.js 24 or newer and git.

```sh
git clone git@github.com:<you>/cascade-reference-tables.git
cd cascade-reference-tables
npm ci
```

`npm ci` also compiles the TypeScript. Table kinds come from [cascade-vocabulary](https://github.com/the-cascade-protocol/cascade-vocabulary).
The host reads it from `$CASCADE_VOCABULARY`, else from a checkout beside this repository named `cascade-vocabulary`, as
it is on disk, else fetches the head of its default branch into `.cache/`. Clone it beside this repository to work
offline.

## Run the checks

These are the commands CI runs.

```sh
npm run typecheck
npm run lint
npm test
```

`npm run format` fixes what the formatting check in `npm run lint` finds. While you work, run one test file, for example
`npm run build && node --test dist/host/test/feed.test.js`.

Name a test to read as behaviour; nothing checks the grammar of a name. CI runs the tests on Node 24.

## What a pull request must pass

CI runs on every pull request, and a red check is a reason not to merge.

- **`check`**: type-check, lint and the tests, as in "Run the checks", against the vocabulary's newest main.
- **`pack`**: packs the package once `check` passes, which is what another repository's pull request depends on. It
  writes into the package a `vocabulary.json` naming the vocabulary commit `check` ran with. (`release`, in the same
  workflow, runs only off pull requests.)

[`CLAUDE.md`](CLAUDE.md) holds the order a requirement is put in, so that a program can check it, and what a change to
`vocab/`, `shapes/`, `rules/` or `builder/` must say in its commit message.

## Commits and pull requests

Use conventional commits: `feat(host): ...`, `feat(cdc-cvx): ...`, `fix(shapes): ...`. Do not put a closing keyword
(`closes`, `fixes`, `resolves`) before an issue the pull request does not finish: GitHub closes it whatever the rest of
the sentence says. The contract rules (what a published version, a builder and a dependency may and may not do) are in
[`CLAUDE.md`](CLAUDE.md).

## A change that spans two repositories

Nothing here pins cascade-vocabulary: CI reads its newest main, or the open pull request a line
`Depends-On: https://github.com/the-cascade-protocol/cascade-vocabulary/pull/<N>` in this pull request's description
names, merged into main. A change both need is a pair of pull requests, each naming the other on that line.

A vocabulary pull request checks the tables' rows against its own row shapes by running `npm test` in a checkout of this
repository, after `npm ci`, with the vocabulary under test checked out beside it as `cascade-vocabulary` or named by
`$CASCADE_VOCABULARY`.

## Licence

Apache-2.0. The feed carries only freely publishable code systems, each with its own attribution; the README says what
it cannot hold and why, so check it before adding a source.
