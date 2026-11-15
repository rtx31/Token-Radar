// A working token-radar-01 entry (Node 22, standard library only), model radar-2.
//
// What the program does, end to end: it reads the sealed snapshot from /input/snapshot.json
// (or --input <file|dir>), scores every pre-token protocol with the model in lib/model.ts,
// writes the ranked board to /output/board.json, and copies this repository's dashboard/
// and screenshots/ to /output. Last, it writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes
// from the same board. The model prices each category from its own live comparables, ranks
// every rankable pre-token protocol below the watchlist floor, and gives every protocol a
// farm plan with costs and times. Change the model, the page or the plan; keep the gate's
// shape — the outputs, the file layout, the dossier call and the caps.
//
// The entry is a pure function of the snapshot: no clock, no randomness, no network. Run
// it twice and the outputs are byte for byte the same, which is what the grade checks.
// Anything it refuses to write — a missing snapshot, a board the gate would refuse, fewer
// than three screenshots — it says so on stderr and exits non-zero, rather than handing
// the grader a broken /output.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_VERSION, boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The repository's own directory: every file the program copies comes from beside main.ts,
// never from a hard-coded container path, so the same program runs in the grader and here.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * One `--name <value>` option out of the arguments, or the fallback. Both spellings work:
 * `--input out/snapshot.json` and `--input=out/snapshot.json`. The spaced spelling wins
 * when both are given, because it is the one a person types first.
 */
function optionValue(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

/** The snapshot file to read: a JSON file as given, or snapshot.json inside a directory. */
function resolveSnapshotFile(): string {
  const inputOption = optionValue('input', '/input');
  return inputOption.endsWith('.json') ? inputOption : join(inputOption, 'snapshot.json');
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const snapshotFile = resolveSnapshotFile();
  if (!existsSync(snapshotFile)) {
    process.stderr.write(`token radar: no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  const outputDir = optionValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  // Score the snapshot. The board is checked against the gate's own shape before anything
  // is written: a board the gate would refuse is refused here, loudly, instead of shipped.
  const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const boardProblem = boardIssue(board, snapshot);
  if (boardProblem !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${boardProblem}\n`);
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

  copyDirectory(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
  const shotNames = copyDirectory(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
  if (shotNames.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shotNames) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes,
  // so no file it reads may change after this line.
  writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: model ${MODEL_VERSION}, ${Object.keys(radar.category_multiples).length} category multiples, global ${radar.global_multiple}, rank 1 ${board[0]!.slug} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}\n` +
      `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (3 files), ${join(outputDir, 'screenshots')} (${shotNames.length} images) and ${join(outputDir, 'dossier.json')}\n`,
  );
}

main();
