/**
 * Publishes the Runora web site to the `gh-pages` branch (GitHub Pages).
 *
 * The site has two parts:
 *
 *   site/          the hand-written pages (landing, privacy, terms) — versioned here
 *   dist/          the Vite build of the app itself — served under /app/
 *
 * The published layout on GitHub Pages is:
 *
 *   /                     landing page (branding, links to the legal pages)
 *   /app/                 the Runora app (OAuth runs here; the origin is what matters)
 *   /privacy.html         privacy policy
 *   /terms.html           terms of use
 *   /assets/              images used by the landing and legal pages
 *   /.nojekyll            tells GitHub Pages to serve the files as-is
 *
 * Usage:
 *   npm run site:deploy              build + publish
 *   npm run site:deploy -- --skip-build   publish the current dist/ as-is
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(ROOT, 'dist');
const WORKTREE = path.join(os.tmpdir(), 'runora-site-deploy');
const BRANCH = 'gh-pages';

const skipBuild = process.argv.includes('--skip-build');

// On Windows npm is a .cmd shim, which execFile cannot spawn directly.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// On Windows npm is a .cmd shim: since Node 22 spawning it directly throws
// EINVAL, so the command goes through cmd.exe.
function run(command, args, cwd = ROOT) {
  if (process.platform === 'win32') {
    const line = [command, ...args].join(' ');
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
      cwd,
      stdio: 'inherit',
    });
    return;
  }
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function copyInto(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

console.log('› Building the app (vite)…');
if (!skipBuild) {
  run(NPM, ['run', 'build']);
} else {
  console.log('  (skipped)');
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  throw new Error('dist/index.html not found — run "npm run build" first.');
}

// A fresh worktree keeps the main checkout clean while the site is assembled.
if (fs.existsSync(WORKTREE)) {
  try {
    git(['worktree', 'remove', '--force', WORKTREE]);
  } catch {
    fs.rmSync(WORKTREE, { recursive: true, force: true });
    git(['worktree', 'prune']);
  }
}

const hasRemoteBranch = git(['ls-remote', '--heads', 'origin', BRANCH], ROOT) !== '';
if (hasRemoteBranch) {
  git(['fetch', 'origin', BRANCH]);
  git(['worktree', 'add', '--detach', WORKTREE, `origin/${BRANCH}`]);
} else {
  git(['worktree', 'add', '--detach', WORKTREE]);
  git(['checkout', '--orphan', 'site-deploy'], WORKTREE);
}

// Empty the branch, then lay the site out from scratch.
git(['rm', '-r', '-f', '.'], WORKTREE);
fs.rmSync(path.join(WORKTREE, 'app'), { recursive: true, force: true });
git(['clean', '-fdx'], WORKTREE);

// Every file in site/ is published as-is: the landing page, the legal pages,
// the branding assets and — when Google asks for it — the site verification
// file (google-site-verification.html), which has to sit in the site root.
copyInto(SITE, WORKTREE);

// The app itself, under /app/ so the root can be the public landing page.
copyInto(DIST, path.join(WORKTREE, 'app'));

// GitHub Pages serves the files as they are (no Jekyll processing).
fs.writeFileSync(path.join(WORKTREE, '.nojekyll'), '');

git(['add', '-A'], WORKTREE);
const changed = git(['status', '--porcelain'], WORKTREE);
if (changed) {
  const message = `chore(site): publish Runora site (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
  git(['commit', '-m', message], WORKTREE);
  git(['push', '--force', 'origin', `HEAD:${BRANCH}`], WORKTREE);
  console.log(`› Published: ${message}`);
} else {
  console.log('› Nothing changed — the site is already up to date.');
}

git(['worktree', 'remove', '--force', WORKTREE]);

console.log('');
console.log('  Site:  https://enzouk.github.io/Runora/');
console.log('  App:   https://enzouk.github.io/Runora/app/');
console.log('  Legal: https://enzouk.github.io/Runora/privacy.html · /terms.html');
