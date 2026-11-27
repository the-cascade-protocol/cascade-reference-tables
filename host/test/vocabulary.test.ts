import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { resolveVocabulary } from "../src/vocabulary.js";

const run = promisify(execFile);
const TERMS = join("ontologies", "cascade.ttl");

/** A git repository standing in for the vocabulary's, holding commit "older" and, at the head of main, "newer". */
async function vocabularyRepository(
  folder: string,
): Promise<{ older: string; newer: string }> {
  const git = async (...args: string[]): Promise<string> =>
    (
      await run("git", [
        "-C",
        folder,
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.org",
        ...args,
      ])
    ).stdout.trim();
  await mkdir(join(folder, "ontologies"), { recursive: true });
  await git("init", "--quiet", "--initial-branch=main");
  await git("config", "uploadpack.allowAnySHA1InWant", "true");
  const commit = async (text: string): Promise<string> => {
    await writeFile(join(folder, TERMS), text);
    await git("add", ".");
    await git("commit", "--quiet", "-m", text);
    return git("rev-parse", "HEAD");
  };
  return { older: await commit("older"), newer: await commit("newer") };
}

describe("Finding the vocabulary · host/src/vocabulary.ts", () => {
  let scratch: string;
  let repository: string;
  let commits: { older: string; newer: string };
  const named = process.env.CASCADE_VOCABULARY;

  /** A folder standing in for this repository's root, with nothing beside it. */
  async function root(name: string): Promise<string> {
    const folder = join(scratch, name, "cascade-reference-tables");
    await mkdir(folder, { recursive: true });
    return folder;
  }

  before(async () => {
    delete process.env.CASCADE_VOCABULARY;
    scratch = await mkdtemp(join(tmpdir(), "vocabulary-"));
    repository = join(scratch, "remote", "cascade-vocabulary");
    commits = await vocabularyRepository(repository);
  });
  after(async () => {
    if (named !== undefined) process.env.CASCADE_VOCABULARY = named;
    await rm(scratch, { recursive: true, force: true });
  });

  describe("given a checkout with the vocabulary checked out beside it", () => {
    it("reads the checkout beside it, with no network", async () => {
      const folder = await root("beside");
      const beside = join(folder, "..", "cascade-vocabulary");
      await mkdir(join(beside, "ontologies"), { recursive: true });
      await writeFile(join(beside, TERMS), "beside");
      const found = await resolveVocabulary(
        folder,
        join(scratch, "no-such-repository"),
      );
      assert.equal(await readFile(join(found.folder, TERMS), "utf8"), "beside");
      assert.match(found.said, /the sibling checkout/);
    });
  });

  describe("given a build that records the vocabulary it was tested with", () => {
    it("reads the vocabulary at the commit it records, not its newest", async () => {
      const folder = await root("recorded");
      await writeFile(
        join(folder, "vocabulary.json"),
        JSON.stringify({ repository, commit: commits.older }),
      );
      const found = await resolveVocabulary(folder, repository);
      assert.equal(await readFile(join(found.folder, TERMS), "utf8"), "older");
      assert.match(found.said, new RegExp(commits.older.slice(0, 12)));
    });
  });

  describe("given a checkout with no vocabulary beside it and no record", () => {
    it("reads the head of the vocabulary's default branch", async () => {
      const found = await resolveVocabulary(await root("newest"), repository);
      assert.equal(await readFile(join(found.folder, TERMS), "utf8"), "newer");
      assert.match(
        found.said,
        new RegExp(
          `${commits.newer.slice(0, 12)}, the head of its default branch`,
        ),
      );
    });
  });
});
