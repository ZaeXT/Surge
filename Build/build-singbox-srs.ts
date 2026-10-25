import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { OUTPUT_SINGBOX_DIR } from './constants/dir';

const SRS_OUTPUT_DIR = path.join(OUTPUT_SINGBOX_DIR, 'srs');
const execFileAsync = promisify(execFile);

export async function buildSingboxSrs(): Promise<void> {
  // A successful build must include SRS output; a missing compiler is an error.
  const { stdout } = await execFileAsync('sing-box', ['version']);
  console.log(stdout.trim());

  const jsonFiles = walkJsonFiles(OUTPUT_SINGBOX_DIR);
  console.log(`[build-srs] Found ${jsonFiles.length} JSON files to compile`);
  if (jsonFiles.length === 0) {
    throw new Error('[build-srs] No sing-box JSON rule sets found');
  }

  // Previous builds may contain rule sets that no longer exist in the source.
  fs.rmSync(SRS_OUTPUT_DIR, { recursive: true, force: true });

  let successCount = 0;
  let failCount = 0;

  for (const jsonFile of jsonFiles) {
    const relPath = path.relative(OUTPUT_SINGBOX_DIR, jsonFile);
    const srsFile = path.join(SRS_OUTPUT_DIR, relPath.replace(/\.json$/, '.srs'));
    const srsDir = path.dirname(srsFile);

    if (!fs.existsSync(srsDir)) {
      fs.mkdirSync(srsDir, { recursive: true });
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- bound compiler memory usage for large rule sets
      await execFileAsync('sing-box', ['rule-set', 'compile', jsonFile, '-o', srsFile]);
      successCount++;
    } catch (e: unknown) {
      failCount++;
      console.error(`[build-srs] Failed to compile ${relPath}:`, e);
    }
  }

  console.log(`[build-srs] Compiled ${successCount} SRS files (${failCount} failed)`);
  if (failCount > 0) {
    throw new Error(`[build-srs] ${failCount} SRS compilation(s) failed`);
  }
}

function walkJsonFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'srs') continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
}
