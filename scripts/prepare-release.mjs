import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Usage: node scripts/prepare-release.mjs <version>');
const desktop = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8'));
const apk = JSON.parse(await readFile(path.join(root, 'wear/build/outputs/apk/release/output-metadata.json'), 'utf8'));
if (desktop.version !== version || apk.variantName !== 'release' || apk.elements.length !== 1 || apk.elements[0].versionName !== version) {
  throw new Error('The desktop or release APK version does not match. Build both before packaging.');
}
const bundle = path.join(root, '.tools/releases', `bundle-${version}`);
const artifacts = [
  [path.join(root, 'wear/build/outputs/apk/release', apk.elements[0].outputFile), `Codex-Watch-${version}.apk`],
  [path.join(root, `.tools/releases/windows/Codex-Watch-Relay-${version}-Setup.exe`), `Codex-Watch-Relay-${version}-Setup.exe`],
];
// A release-labelled but unsigned APK cannot be installed or safely published.
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME or ANDROID_SDK_ROOT so the APK signature can be verified.');
let tools = [];
try { tools = (await readdir(path.join(sdk, 'build-tools'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})); } catch {}
let verifier;
for (const version of tools) {
  const jar = path.join(sdk, 'build-tools', version, 'lib', 'apksigner.jar');
  try { await access(jar); verifier = jar; break; } catch {}
}
if (!verifier) throw new Error('Android apksigner was not found in the SDK build-tools.');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
try { execFileSync(java, ['-jar', verifier, 'verify', '--verbose', artifacts[0][0]], { stdio:'pipe', timeout:30000 }); }
catch { throw new Error('APK signature verification failed. Check the release signing identity and Android SDK.'); }
for (const [source] of artifacts) await access(source);
await mkdir(path.dirname(bundle), { recursive: true });
try { await mkdir(bundle); }
catch (error) { if (error.code === 'EEXIST') throw new Error('Release bundle already exists; review it before choosing a new version.'); throw error; }
const checksums = [];
for (const [source, name] of artifacts) {
  const destination = path.join(bundle, name);
  await copyFile(source, destination);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(destination)) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(path.join(bundle, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(`Prepared ${artifacts.length} files and SHA256SUMS.txt in ${bundle}`);
console.log('APK signature verified. Test both artifacts before uploading.');
