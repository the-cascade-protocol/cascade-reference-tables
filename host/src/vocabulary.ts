import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  Graph,
  OWL,
  parseTurtle,
  type Quad,
  RDF,
  CASCADE,
  SH,
  SKOS,
  VOID,
} from "./rdf.js";

const run = promisify(execFile);
const TERMS = "ontologies/cascade.ttl";
const SHAPES = "ontologies/cascade.shapes.ttl";

const REPOSITORY = "https://github.com/the-cascade-protocol/cascade-vocabulary";
const SIBLING = "cascade-vocabulary";

/** What a published build records, in its `vocabulary.json`, of the vocabulary it was tested with. */
export interface Recorded {
  readonly repository: string;
  readonly commit: string;
  readonly how?: string;
}

/** The folder the vocabulary is read from, and how it was found. */
export interface Resolved {
  readonly folder: string;
  readonly said: string;
}

async function git(folder: string, ...args: string[]): Promise<string> {
  return (await run("git", ["-C", folder, ...args])).stdout.trim();
}

/**
 * The vocabulary's folder, first match wins: `CASCADE_VOCABULARY`; the sibling checkout `../cascade-vocabulary`; the
 * commit a published build's `vocabulary.json` records; the head of the vocabulary's default branch. A commit is
 * fetched once into `.cache/`.
 */
export async function resolveVocabulary(
  root: string,
  repository = REPOSITORY,
): Promise<Resolved> {
  const named = process.env.CASCADE_VOCABULARY;
  if (named !== undefined && named !== "")
    return { folder: resolve(named), said: `cascade-vocabulary: ${named}` };
  const sibling = join(dirname(resolve(root)), SIBLING);
  if (existsSync(join(sibling, TERMS))) {
    const commit = await git(sibling, "rev-parse", "HEAD").catch(() => "");
    return {
      folder: sibling,
      said: `cascade-vocabulary: the sibling checkout ${sibling}${commit === "" ? "" : ` at ${commit.slice(0, 12)}`}`,
    };
  }
  const record = join(root, "vocabulary.json");
  if (existsSync(record)) {
    const recorded = JSON.parse(await readFile(record, "utf8")) as Recorded;
    return {
      folder: await fetched(root, recorded.repository, recorded.commit),
      said: `cascade-vocabulary: ${recorded.commit.slice(0, 12)}, which this build was tested with${recorded.how === undefined ? "" : ` (${recorded.how})`}`,
    };
  }
  const head = (await run("git", ["ls-remote", repository, "HEAD"])).stdout
    .trim()
    .split(/\s/)[0];
  if (head === undefined || head === "")
    throw new Error(`${repository} has no default branch`);
  return {
    folder: await fetched(root, repository, head),
    said: `cascade-vocabulary: ${head.slice(0, 12)}, the head of its default branch; check it out beside this repository as ${SIBLING} to read it with no network`,
  };
}

/** The vocabulary's files at a commit, fetched once into `.cache/`. */
async function fetched(
  root: string,
  repository: string,
  commit: string,
): Promise<string> {
  const folder = join(root, ".cache", "cascade-vocabulary", commit);
  if (!existsSync(join(folder, TERMS))) {
    await mkdir(dirname(folder), { recursive: true });
    const partial = await mkdtemp(`${folder}.partial-`);
    await git(partial, "init", "--quiet");
    await git(partial, "fetch", "--quiet", "--depth", "1", repository, commit);
    await git(
      partial,
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "FETCH_HEAD",
    );
    // Another run fetching the same commit may have put it in place first.
    await rename(partial, folder).catch(async (error: unknown) => {
      if (!existsSync(join(folder, TERMS))) throw error;
      await rm(partial, { recursive: true, force: true });
    });
  }
  return folder;
}

/** A table kind as the vocabulary states it. */
export interface Kind {
  readonly iri: string;
  readonly rowShape: string;
}

/** What the host reads from the vocabulary: the table kinds, their row shapes and the code systems. */
export class Vocabulary {
  #spaces: { system: string; space: string }[] | undefined;
  #shapes: Graph | undefined;

  private constructor(
    readonly folder: string,
    readonly terms: Graph,
    readonly shapes: readonly Quad[],
  ) {}

  static async read(folder: string): Promise<Vocabulary> {
    const read = async (file: string): Promise<Quad[]> =>
      parseTurtle(await readFile(join(folder, file), "utf8"), `${CASCADE}`);
    return new Vocabulary(
      folder,
      new Graph(await read(TERMS)),
      await read(SHAPES),
    );
  }

  declares(kind: string): boolean {
    return this.terms.value(kind, `${CASCADE}rowShape`) !== undefined;
  }

  kind(iri: string): Kind {
    const rowShape = this.terms.value(iri, `${CASCADE}rowShape`);
    if (rowShape === undefined) throw new Error(`${iri} is not a table kind`);
    return { iri, rowShape };
  }

  /** The one predicate a kind's row shape fixes on `owl:annotatedProperty` with `sh:hasValue`; `undefined` for none or several. */
  fixedProperty(kind: string): string | undefined {
    this.#shapes ??= new Graph(this.shapes);
    const shapes = this.#shapes;
    const fixed = shapes
      .objects(this.kind(kind).rowShape, `${SH}property`)
      .filter((p) => shapes.value(p, `${SH}path`) === `${OWL}annotatedProperty`)
      .flatMap((p) => shapes.objects(p, `${SH}hasValue`));
    return fixed.length === 1 ? fixed[0]!.value : undefined;
  }

  /** A code of a system, from its IRI; `undefined` outside the system's `void:uriSpace`. */
  codeOf(system: string, codeIri: string): string | undefined {
    const space = this.terms.value(system, `${VOID}uriSpace`);
    if (space === undefined) throw new Error(`${system} is not a code system`);
    return codeIri.startsWith(space)
      ? decodeURIComponent(codeIri.slice(space.length))
      : undefined;
  }

  /** The code system whose `void:uriSpace` the IRI starts with, the longest space first; `undefined` for none. */
  systemOf(codeIri: string): string | undefined {
    this.#spaces ??= this.terms
      .subjects(`${RDF}type`, `${CASCADE}CodeSystem`)
      .flatMap((system) => {
        const space = this.terms.value(system, `${VOID}uriSpace`);
        return space === undefined ? [] : [{ system, space }];
      })
      .sort((a, b) => b.space.length - a.space.length);
    return this.#spaces.find(({ space }) => codeIri.startsWith(space))?.system;
  }

  /** A code's IRI: its system's `void:uriSpace` followed by the code as SPARQL's `ENCODE_FOR_URI` writes it. */
  codeIri(system: string, code: string): string {
    const space = this.terms.value(system, `${VOID}uriSpace`);
    if (space === undefined) throw new Error(`${system} is not a code system`);
    return (
      space +
      encodeURIComponent(code).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      )
    );
  }

  /** Each label of a concept of the scheme, its preferred, alternative and notation, with the concept's IRI. */
  concepts(scheme: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const concept of this.terms.subjects(`${SKOS}inScheme`, scheme))
      for (const predicate of ["prefLabel", "altLabel", "notation"])
        for (const label of this.terms.objects(
          concept,
          `${SKOS}${predicate}`,
        )) {
          const held = found.get(label.value);
          if (held !== undefined && held !== concept)
            throw new Error(
              `${scheme} gives "${label.value}" to ${held} and ${concept}`,
            );
          found.set(label.value, concept);
        }
    return found;
  }

  /** A concept's preferred label, where the vocabulary gives one. */
  labelOf(concept: string): string | undefined {
    return this.terms.value(concept, `${SKOS}prefLabel`);
  }
}
