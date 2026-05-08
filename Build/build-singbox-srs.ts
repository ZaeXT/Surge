import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_SINGBOX_DIR } from './constants/dir';

const SRS_OUTPUT_DIR = path.join(OUTPUT_SINGBOX_DIR, 'srs');

export async function buildSingboxSrs(): Promise<void> {
  const singboxBin = findSingbox();
  if (!singboxBin) {
    console.warn('[build-srs] sing-box not found, skipping SRS compilation');
    return;
  }

  console.log(`[build-srs] Using sing-box: ${singboxBin}`);

  const jsonFiles = walkJsonFiles(OUTPUT_SINGBOX_DIR);
  console.log(`[build-srs] Found ${jsonFiles.length} JSON files to compile`);

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
      execFileSync(singboxBin, ['rule-set', 'compile', jsonFile, '-o', srsFile], {
        stdio: 'pipe'
      });
      successCount++;
    } catch (e: unknown) {
      failCount++;
      const stderr = (e as { stderr?: Buffer }).stderr;
      console.error(`[build-srs] Failed to compile ${relPath}:`, stderr ? stderr.toString().trim() : e);
    }
  }

  console.log(`[build-srs] Compiled ${successCount} SRS files (${failCount} failed)`);
  if (failCount > 0) {
    throw new Error(`[build-srs] ${failCount} SRS compilation(s) failed`);
  }
}

function findSingbox(): string | null {
  try {
    const binPath = execFileSync('which', ['sing-box'], { stdio: 'pipe' }).toString().trim();
    return binPath || null;
  } catch {
    return null;
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
