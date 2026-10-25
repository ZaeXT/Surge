import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

describe('buildSingboxSrs', function () {
  this.timeout(15000);
  let publicDir: string;

  beforeEach(() => {
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleset-srs-'));
    fs.mkdirSync(path.join(publicDir, 'sing-box'));
  });

  afterEach(() => {
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  function writeRule(relativePath: string, rules: unknown) {
    const file = path.join(publicDir, 'sing-box', relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 2, rules }));
  }

  function build(searchPath = process.env.PATH) {
    return spawnSync(process.execPath, [
      '-r', '@swc-node/register', '-e',
      'require("./Build/build-singbox-srs").buildSingboxSrs().catch(e => { console.error(e); process.exitCode = 1; })'
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PUBLIC_DIR: publicDir, PATH: searchPath, SWC_NODE_IGNORE_DYNAMIC: 'true' },
      encoding: 'utf8',
      timeout: 10000
    });
  }

  it('compiles domain and IP rules with sing-box and removes stale SRS output', () => {
    writeRule('domainset/example.json', [{ domain_suffix: ['example.com'] }]);
    writeRule('ip/example.json', [{ ip_cidr: ['192.0.2.0/24'] }]);
    const staleFile = path.join(publicDir, 'sing-box/srs/obsolete.srs');
    fs.mkdirSync(path.dirname(staleFile), { recursive: true });
    fs.writeFileSync(staleFile, 'obsolete');

    const result = build();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(staleFile), false);
    for (const type of ['domainset', 'ip']) {
      const file = path.join(publicDir, `sing-box/srs/${type}/example.srs`);
      assert.ok(fs.statSync(file).size > 0);
      assert.equal(fs.readFileSync(file).subarray(0, 3).toString(), 'SRS');
    }
  });

  it('fails when the compiler is missing', () => {
    writeRule('domainset/example.json', [{ domain: ['example.com'] }]);
    const result = build(path.join(publicDir, 'missing-bin'));
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
  });

  it('fails when there are no JSON rule sets', () => {
    const result = build();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No sing-box JSON rule sets found/);
  });

  it('fails the build if any JSON rule set cannot be compiled', () => {
    writeRule('domainset/valid.json', [{ domain: ['example.com'] }]);
    writeRule('ip/invalid.json', [{ ip_cidr: ['invalid-cidr'] }]);
    const result = build();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to compile ip[/\\]invalid.json/);
    assert.match(result.stderr, /1 SRS compilation\(s\) failed/);
  });
});
