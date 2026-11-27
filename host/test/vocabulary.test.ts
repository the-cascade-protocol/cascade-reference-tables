import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { recordVocabulary, resolveVocabulary } from "../src/vocabulary.js";

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

    it("refuses a commit its repository lacks, leaving nothing in .cache/", async () => {
      const folder = await root("lacking");
      await writeFile(
        join(folder, "vocabulary.json"),
        JSON.stringify({ repository, commit: "0".repeat(40) }),
      );
      await assert.rejects(resolveVocabulary(folder, repository));
      assert.deepEqual(
        await readdir(join(folder, ".cache", "cascade-vocabulary")),
        [],
      );
    });
  });

  describe("given a record naming a repository other than the vocabulary's", () => {
    for (const [what, other] of [
      ["another repository", "https://example.invalid/someone/else"],
      ["a local path", join(tmpdir(), "somewhere", "cascade-vocabulary")],
      ["a url", "http://127.0.0.1:1/cascade-vocabulary.git"],
    ] as const)
      it(`refuses ${what}, naming it, and fetches nothing`, async () => {
        const folder = await root(`other-${what.replace(/ /g, "-")}`);
        await writeFile(
          join(folder, "vocabulary.json"),
          JSON.stringify({ repository: other, commit: commits.older }),
        );
        await assert.rejects(
          resolveVocabulary(folder, repository),
          (error: Error) =>
            error.message.includes(other) &&
            /vocabulary\.json names/.test(error.message),
        );
        assert.equal(existsSync(join(folder, ".cache")), false);
      });
  });

  describe("given a record whose commit its repository cannot give", () => {
    it("says what the record is and to put the vocabulary beside or name it by CASCADE_VOCABULARY", async () => {
      const folder = await root("cannot-give");
      await writeFile(
        join(folder, "vocabulary.json"),
        JSON.stringify({
          repository,
          commit: "0".repeat(40),
          how: "pull request 7 merged into main",
        }),
      );
      await assert.rejects(
        resolveVocabulary(folder, repository),
        (error: Error) =>
          error.message.includes("0".repeat(40)) &&
          error.message.includes("pull request 7 merged into main") &&
          /beside it/.test(error.message) &&
          /CASCADE_VOCABULARY/.test(error.message),
      );
    });
  });

  describe("given a record whose commit is not a commit", () => {
    it("refuses it, naming the record", async () => {
      const folder = await root("malformed");
      await writeFile(
        join(folder, "vocabulary.json"),
        JSON.stringify({ repository, commit: "../../elsewhere" }),
      );
      await assert.rejects(
        resolveVocabulary(folder, repository),
        /vocabulary\.json names no repository and commit/,
      );
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

    it("records the commit it read, as a package build does", async () => {
      const folder = await root("head-recorded");
      const found = await resolveVocabulary(folder, repository);
      const out = join(folder, "out");
      await recordVocabulary(out, found);
      assert.deepEqual(
        JSON.parse(await readFile(join(out, "vocabulary.json"), "utf8")),
        {
          repository,
          commit: commits.newer,
          how: "the head of its default branch",
        },
      );
    });

    it("records nothing for a vocabulary it was named or found beside it", async () => {
      const out = join(scratch, "out-named");
      await recordVocabulary(out, { folder: "x", said: "x" });
      assert.equal(existsSync(join(out, "vocabulary.json")), false);
    });

    it("uses the cached vocabulary offline, saying which commit and that it could not look for a newer one", async () => {
      const folder = await root("offline");
      await resolveVocabulary(folder, repository);
      const found = await resolveVocabulary(
        folder,
        "http://127.0.0.1:1/cascade-vocabulary.git",
      );
      assert.equal(await readFile(join(found.folder, TERMS), "utf8"), "newer");
      assert.match(found.said, new RegExp(commits.newer.slice(0, 12)));
      assert.match(found.said, /could not check for a newer one/);
      assert.equal(found.recorded?.commit, commits.newer);
      assert.match(found.recorded?.how ?? "", /could not check/);
    });

    it("fetches from a root as long as one deep in a project's node_modules on Windows", {
      skip: process.platform !== "win32" && "the path limit is Windows'",
    }, async () => {
      let folder = join(scratch, "long");
      while (folder.length < 105)
        folder = join(folder, "node_modules_of_a_deep_project");
      folder = join(folder, "cascade-reference-tables");
      await mkdir(folder, { recursive: true });
      const found = await resolveVocabulary(folder, repository);
      assert.equal(await readFile(join(found.folder, TERMS), "utf8"), "newer");
    });

    it("says to check the vocabulary out beside it when its repository cannot be read", async () => {
      await assert.rejects(
        resolveVocabulary(
          await root("unreadable"),
          join(scratch, "no-such-repository"),
        ),
        /check it out beside this repository as cascade-vocabulary/,
      );
    });
  });
});
