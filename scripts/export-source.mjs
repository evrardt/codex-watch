import {readdir,readFile,mkdir,writeFile,copyFile}from'node:fs/promises';
import path from'node:path';import{fileURLToPath}from'node:url';import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const audit=process.argv[2]==='--audit';
const version=(audit?null:process.argv[2])||JSON.parse(await readFile(path.join(root,'desktop/package.json'),'utf8')).version;if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release version');
const output=audit?path.join(root,'.tools/source-audits',randomUUID()):path.join(root,'.tools/releases/source-'+version);
await mkdir(path.dirname(output),{recursive:true});
try{await mkdir(output);}catch(e){if(e.code==='EEXIST')throw Error('Release export already exists; choose a new version or review it before removing it.');throw e;}
const roots=['bridge','wear','pairing','opusbridge','gradle','desktop','server-tools','.github'];
const files=['README.md','GUIDE-INSTALLATION.html','LICENSE','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md','.gitignore','build.gradle.kts','gradle.properties','settings.gradle.kts','gradlew','gradlew.bat','scripts/export-source.mjs','scripts/prepare-release.mjs','scripts/test-bluetooth.ps1','scripts/test-desktop-perf.cjs','scripts/render-guide-html.py','scripts/guide-preload.cjs','scripts/guide-screenshots.cjs','docs/INSTALLATION-AVANCEE.md','docs/PUBLICATION.md','docs/PRIVACY.md','docs/STORE.md','docs/QA-0.9.md','docs/QA-0.9.1.md','docs/QA-0.9.2.md','docs/QA-0.9.3.md','docs/QA-0.9.4.md','docs/QA-0.10.md','docs/AUDIT-LIVE.md','docs/QA-0.11.md','docs/QA-0.11.1.md','docs/QA-0.11.2.md','docs/QA-0.11.5.md','docs/QA-0.12.4.md','docs/QA-0.12.7.md','docs/QA-0.12.8.md','docs/QA-0.12.9.md','docs/QA-0.12.10.md','docs/QA-0.12.11.md','docs/QA-0.12.12.md','docs/QA-0.12.13.md','docs/QA-0.12.14.md','docs/QA-0.12.15.md','docs/QA-0.12.16.md','docs/QA-0.12.17.md','docs/QA-0.12.18.md','docs/QA-0.12.19.md','docs/QA-0.12.20.md','docs/QA-0.12.21.md','docs/QA-0.12.22.md','docs/QA-0.12.23.md','docs/RECHERCHE-LIVE-PLUGINS.md'];
files.push('docs/QA-0.12.24.md','docs/QA-0.12.25.md');
files.push('docs/INSTALLER-VPS.md','docs/INSTALLER-VPS.html');
files.push('scripts/guide-vps-screenshot.cjs');
files.push('docs/ETUDE-ASSISTANCE-CONVERSATION.md');
files.push('docs/RAPPORT-ETAT.md');
files.push('docs/NOTIFICATIONS.md');
files.push('docs/ROADMAP.md','docs/QA-0.12.34.md','docs/QA-0.12.35.md');
files.push('docs/QA-0.12.37.md');
files.push('docs/QA-0.12.38.md');
files.push('docs/QA-0.12.39.md','docs/QA-0.12.40.md','docs/QA-0.12.41.md','docs/QA-0.12.42.md',
  'docs/QA-0.12.43.md','docs/QA-0.12.44.md','docs/QA-0.12.45.md','docs/QA-0.12.46.md');
const excluded=new Set(['node_modules','build','.gradle','.kotlin','.local','.tools','dist','__pycache__']);
async function walk(dir){for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){if(excluded.has(entry.name))continue;const file=dir+'/'+entry.name;if(entry.isDirectory())await walk(file);else if(entry.isFile()&&!['config.json','.env','local.properties','secrets.json','phonon-compute-status.json','phonon-compute.json'].includes(entry.name)&&!/^\.env\.(?!example$)/i.test(entry.name)&&!/(?:service-account.*\.json|\.(?:key|pfx|pem|p12|jks|keystore|apk|aab|exe|msi|zip|log|sqlite|sqlite3|db))$/i.test(entry.name))files.push(file);}}
for(const dir of roots)await walk(dir);await walk('docs/store-assets');await walk('docs/guide');
for(const file of files){
  const source=path.join(root,file);const content=await readFile(source);
  if(/\.(?:md|mjs|cjs|js|json|xml|kt|kts|java|properties|html|css|yml|ps1|sh|bat|py)$/.test(file)||file==='server-tools/apparmor-codex-watch'){
    const text=content.toString('utf8');
    if(/sk-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{15,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|C:[\\/]+Users[\\/]+[A-Za-z]+[\\/]+|192\.168\.\d+\.\d+|https:\/\/[a-z0-9-]+\.tail[a-f0-9]+\.ts\.net/i.test(text))throw Error('Private content detected in '+file);
  }
  const target=path.join(output,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);
}
await writeFile(path.join(root,'.tools/releases/source-audit.json'),JSON.stringify({version,files:files.length,privatePatternsFound:false},null,2));
console.log(JSON.stringify({output,files:files.length,privatePatternsFound:false}));
