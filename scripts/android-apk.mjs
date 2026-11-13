#!/usr/bin/env node
/**
 * Monta os APKs do Runora (desenvolvimento e produção) e instala o escolhido.
 *
 * POR QUE DOIS APKs
 *   - "dev"  → carrega a interface do Vite que roda no PC
 *              (`http://10.0.2.2:3000` no emulador). Cada alteração no PC
 *              aparece na hora, sem rebuild e sem reinstalar.
 *   - "prod" → usa o bundle embutido no APK: funciona sozinho, sem PC.
 *              É este que vai para o celular real.
 *
 * POR QUE ELES CONVIVEM
 *   O APK de dev é OUTRO pacote (`com.runora.fsrs.dev`, nome "Runora Dev"),
 *   então fica instalado AO LADO do de produção (`com.runora.fsrs`) — sem
 *   trocar um pelo outro e sem perder os dados de nenhum dos dois.
 *
 * REGRA IMPORTANTE
 *   Os dois são montados SEMPRE juntos, do mesmo `dist` (regra do AGENTS.md):
 *   o comando instala só um deles, mas nunca fica um "dev velho" com um
 *   "prod novo" (ou vice-versa).
 *
 * USO
 *   npm run android:dev                   monta os dois e instala o de dev
 *   npm run android:prod                  monta os dois e instala o de prod
 *   npm run android:dev -- --no-install   só monta (não instala)
 *   npm run android:dev -- --skip-build   não refaz o `dist` (usa o que já está)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const ANDROID = path.join(ROOT, 'android');
const GRADLEW = path.join(ANDROID, 'gradlew.bat');
const GRADLE_OUT = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

/** Endereço do Vite do PC visto pelo emulador Android (10.0.2.2 = localhost). */
const DEV_SERVER_URL = 'http://10.0.2.2:3000';

const DEV_PACKAGE = 'com.runora.fsrs.dev';
const PROD_PACKAGE = 'com.runora.fsrs';

const mode = (process.argv[2] || '').toLowerCase();
const noInstall = process.argv.includes('--no-install');
const skipBuild = process.argv.includes('--skip-build');

if (mode !== 'dev' && mode !== 'prod') {
  console.error('Uso: node scripts/android-apk.mjs <dev|prod> [--no-install] [--skip-build]');
  process.exit(1);
}

// ---------------------------------------------------------------- utilidades

function run(command, args, options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || ROOT;
  if (process.platform === 'win32') {
    // No Windows, npm/npx/gradlew são shims .cmd: passam pelo cmd.exe.
    const line = [command, ...args].join(' ');
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
      cwd,
      stdio: 'inherit',
      env,
    });
    return;
  }
  execFileSync(command, args, { cwd, stdio: 'inherit', env });
}

function capture(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd || ROOT,
      encoding: 'utf8',
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  } catch (e) {
    return (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
  }
}

function step(text) {
  console.log(`\n=== ${text} ===`);
}

function fileSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

// -------------------------------------------------------------- Java / SDK

/** O Gradle do projeto precisa do JDK 21 (o Java 25 não é aceito). */
function resolveJavaHome(env) {
  const current = env.JAVA_HOME;
  if (current && fs.existsSync(path.join(current, 'bin', 'java.exe'))) return current;
  const candidates = [
    'C:\\Program Files\\Java\\jdk-21',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
    path.join(os.homedir(), '.jdks', 'jdk-21'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bin', 'java.exe'))) return dir;
  }
  if (current) return current; // deixa o Gradle reclamar com uma mensagem clara
  console.warn('!! JAVA_HOME não encontrado — o Gradle pode falhar (o projeto pede o JDK 21).');
  return undefined;
}

function resolveSdkDir() {
  const fromLocalProps = path.join(ANDROID, 'local.properties');
  if (fs.existsSync(fromLocalProps)) {
    const m = fs.readFileSync(fromLocalProps, 'utf8').match(/sdk\.dir=(.+)/);
    if (m) return m[1].trim().replace(/\\/g, path.sep);
  }
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv) return fromEnv;
  const fallback = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
  return fs.existsSync(fallback) ? fallback : null;
}

function resolveAdb(sdkDir) {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  if (sdkDir) {
    const candidate = path.join(sdkDir, 'platform-tools', exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'adb'; // tenta o PATH
}

// -------------------------------------------------------------- montagem

function buildDist() {
  step('1/5 — build da interface (dist)');
  run('npm', ['run', 'build']);
}

function capCopy(env) {
  run('npx', ['cap', 'copy', 'android'], { env });
}

function gradleAssemble(env, devBuild) {
  const args = ['assembleDebug'];
  if (devBuild) args.push('-PdevBuild=true');
  run(GRADLEW, args, { cwd: ANDROID, env });
}

function copyApk(destName) {
  const dest = path.join(RELEASE, destName);
  fs.mkdirSync(RELEASE, { recursive: true });
  fs.copyFileSync(GRADLE_OUT, dest);
  return dest;
}

/** Lê o pacote e o rótulo do APK (aapt2 do SDK), para conferir no fim. */
function inspectApk(apkPath, sdkDir) {
  if (!sdkDir) return null;
  const aapt2 = path.join(sdkDir, 'build-tools', '35.0.0', 'aapt2.exe');
  if (!fs.existsSync(aapt2)) return null;
  const out = capture(aapt2, ['dump', 'badging', apkPath]);
  const pkg = out.match(/package: name='([^']+)'/);
  const label = out.match(/application-label:'([^']*)'/);
  return { package: pkg ? pkg[1] : null, label: label ? label[1] : null };
}

// ------------------------------------------------------------- instalação

function connectedDevices(adb) {
  const out = capture(adb, ['devices']);
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map((parts) => parts[0]);
}

function install(adb, apkPath) {
  step('5/5 — instalar no aparelho');
  const devices = connectedDevices(adb);
  if (devices.length === 0) {
    console.log('!! Nenhum aparelho conectado (ligue o emulador ou o celular).');
    console.log('   O APK ficou pronto em: ' + apkPath);
    return false;
  }
  console.log('Aparelhos: ' + devices.join(', '));
  const out = capture(adb, ['-s', devices[0], 'install', '-r', apkPath]);
  console.log(out.trim());
  if (!/Success/i.test(out)) {
    console.log('!! A instalação não deu certo (veja a mensagem acima).');
    return false;
  }
  const pkg = mode === 'dev' ? DEV_PACKAGE : PROD_PACKAGE;
  capture(adb, ['-s', devices[0], 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
  console.log(`App aberto: ${pkg}`);
  return true;
}

// ------------------------------------------------------------------ main

const sdkDir = resolveSdkDir();
const adb = resolveAdb(sdkDir);
const javaHome = resolveJavaHome(process.env);
const env = { ...process.env };
if (javaHome) env.JAVA_HOME = javaHome;

console.log(`Runora — APK ${mode === 'dev' ? 'de DESENVOLVIMENTO' : 'de PRODUÇÃO'}`);
console.log(`Java: ${javaHome || '(não encontrado)'}`);
console.log(`SDK:  ${sdkDir || '(não encontrado)'}`);

if (!skipBuild) buildDist();

// 1) APK de desenvolvimento (bundle embutido + Vite via CAP_SERVER_URL)
step('2/5 — APK de desenvolvimento (com Vite, pacote próprio)');
const devEnv = { ...env, CAP_SERVER_URL: DEV_SERVER_URL };
capCopy(devEnv);
gradleAssemble(devEnv, true);
const devApk = copyApk('Runora-APK-dev.apk');
console.log(`Gerado: ${devApk} (${fileSize(fs.statSync(devApk).size)})`);

// 2) APK de produção (bundle embutido, sem servidor externo) — SEMPRE por
//    último: é o estado em que a pasta `android/` deve ficar.
step('3/5 — APK de produção (bundle embutido)');
const prodEnv = { ...env };
delete prodEnv.CAP_SERVER_URL;
capCopy(prodEnv);
gradleAssemble(prodEnv, false);
const prodApk = copyApk('Runora-APK-prod.apk');
console.log(`Gerado: ${prodApk} (${fileSize(fs.statSync(prodApk).size)})`);

step('4/5 — conferência');
const devInfo = inspectApk(devApk, sdkDir);
const prodInfo = inspectApk(prodApk, sdkDir);
if (devInfo) console.log(`dev  → pacote ${devInfo.package} / rótulo "${devInfo.label}"`);
if (prodInfo) console.log(`prod → pacote ${prodInfo.package} / rótulo "${prodInfo.label}"`);
if (devInfo && prodInfo && devInfo.package === prodInfo.package) {
  console.log('!! Os dois APKs têm o MESMO pacote — um substituiria o outro!');
} else if (devInfo && prodInfo) {
  console.log('OK: os dois convivem (pacotes diferentes).');
}
console.log(`Pasta android/ deixada no estado de PRODUÇÃO (config sem server.url).`);

if (noInstall) {
  step('5/5 — instalação pulada (--no-install)');
  console.log(`Dev:  ${devApk}`);
  console.log(`Prod: ${prodApk}`);
} else {
  const chosen = mode === 'dev' ? devApk : prodApk;
  install(adb, chosen);
  console.log(`\nDev:  ${devApk}`);
  console.log(`Prod: ${prodApk}`);
  if (mode === 'dev') {
    console.log('\nO app "Runora Dev" puxa a interface do Vite do PC:');
    console.log('  npm run dev   →  http://127.0.0.1:3000  (o emulador vê em 10.0.2.2:3000)');
    console.log('Ele tem dados próprios (começa vazio) e NÃO é o app do seu celular.');
  }
}
