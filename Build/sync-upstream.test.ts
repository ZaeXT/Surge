import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';

describe('sync upstream workflow', function () {
  this.timeout(15000);
  let root: string;
  let upstream: string;
  let fork: string;
  let remote: string;
  let env: NodeJS.ProcessEnv;

  const workflow = parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-webdav.yml'), 'utf8')) as {
    jobs: { sync_upstream: { steps: Array<{ id?: string, run?: string }> } }
  };
  const script = workflow.jobs.sync_upstream.steps.find(step => step.id === 'sync')?.run;
  assert.ok(script, 'sync step must exist');

  function git(cwd: string, ...args: string[]) {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe', timeout: 10000 }).trim();
  }

  function write(cwd: string, file: string, content: string) {
    const target = path.join(cwd, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  function commit(cwd: string, message: string) {
    git(cwd, 'add', '--all');
    git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-m', message);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleset-sync-'));
    const gnupg = path.join(root, 'gnupg');
    fs.mkdirSync(gnupg, { mode: 0o700 });
    env = {
      ...process.env,
      GNUPGHOME: gnupg,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GITHUB_OUTPUT: path.join(root, 'output')
    };
    execFileSync('gpg', [
      '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-generate-key', 'Workflow Test <workflow-test@example.invalid>', 'ed25519', 'sign', '1d'
    ], { env, stdio: 'pipe', timeout: 10000 });

    upstream = path.join(root, 'upstream');
    fork = path.join(root, 'fork');
    remote = path.join(root, 'origin.git');
    git(root, 'init', '--initial-branch=master', upstream);
    git(upstream, 'config', 'user.name', 'Workflow Test');
    git(upstream, 'config', 'user.email', 'workflow-test@example.invalid');
    write(upstream, '.github/workflows/main.yml', 'base workflow\n');
    write(upstream, '.github/workflows/toggle.yml', 'base visibility workflow\n');
    write(upstream, 'Source/rule.txt', 'base rule\n');
    commit(upstream, 'base');
    git(root, 'clone', '--bare', upstream, remote);
    git(root, 'clone', remote, fork);
    git(fork, 'config', 'user.name', 'Workflow Test');
    git(fork, 'config', 'user.email', 'workflow-test@example.invalid');
    git(fork, 'config', 'user.signingkey', 'workflow-test@example.invalid');
    write(fork, '.github/workflows/main.yml', 'fork workflow\n');
    write(fork, '.github/workflows/deploy-webdav.yml', 'fork deployment\n');
    fs.unlinkSync(path.join(fork, '.github/workflows/toggle.yml'));
    commit(fork, 'customize fork workflows');
    git(fork, 'push', 'origin', 'HEAD:master');
    write(upstream, '.github/workflows/main.yml', 'upstream workflow\n');
    write(upstream, '.github/workflows/toggle.yml', 'updated visibility workflow\n');
    write(upstream, '.github/workflows/new.yml', 'new upstream workflow\n');
    write(upstream, 'Source/rule.txt', 'updated upstream rule\n');
    commit(upstream, 'update workflows and rules');
  });

  afterEach(() => {
    execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env, timeout: 10000 });
    fs.rmSync(root, { recursive: true, force: true });
  });

  function sync() {
    return spawnSync('bash', ['-c', script!.replace('https://github.com/SukkaW/Surge.git', upstream)], {
      cwd: fork, env, encoding: 'utf8', timeout: 10000
    });
  }

  it('preserves fork workflows across content and modify/delete conflicts, signs and pushes once', () => {
    const workflowTree = git(fork, 'rev-parse', 'HEAD:.github/workflows');
    const result = sync();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(git(fork, 'rev-parse', 'HEAD:.github/workflows'), workflowTree);
    assert.equal(fs.existsSync(path.join(fork, '.github/workflows/toggle.yml')), false);
    assert.equal(fs.existsSync(path.join(fork, '.github/workflows/new.yml')), false);
    assert.equal(fs.readFileSync(path.join(fork, 'Source/rule.txt'), 'utf8'), 'updated upstream rule\n');
    assert.equal(git(fork, 'diff', '--name-only', '--diff-filter=U'), '');
    git(fork, 'verify-commit', 'HEAD');
    const sha = git(fork, 'rev-parse', 'HEAD');
    assert.equal(git(remote, 'rev-parse', 'master'), sha);
    assert.equal(sync().status, 0);
    assert.equal(git(fork, 'rev-parse', 'HEAD'), sha);
  });

  it('rejects source conflicts without pushing', () => {
    write(fork, 'Source/rule.txt', 'fork rule\n');
    commit(fork, 'customize fork source');
    git(fork, 'push', 'origin', 'HEAD:master');
    const sha = git(remote, 'rev-parse', 'master');
    const result = sync();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Upstream source conflicts require manual resolution:/);
    assert.equal(git(fork, 'diff', '--name-only', '--diff-filter=U'), 'Source/rule.txt');
    assert.equal(git(remote, 'rev-parse', 'master'), sha);
  });
});
