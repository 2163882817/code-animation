import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inspectRelease,prepareRelease} from '../scripts/release.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'out');fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(out,'cli-test-'));
let releaseTemp;
after(()=>{
  for(const [directory,parent,prefix] of [[temp,out,'cli-test-'],[releaseTemp,path.join(root,'dist'),'release-test-']]){
    if(!directory)continue;
    const resolved=fs.realpathSync(directory),base=fs.realpathSync(parent);
    assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith(prefix));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
function run(script,args=[],cwd=root){return spawnSync(process.execPath,[path.join(root,'scripts',script),...args],{cwd,encoding:'utf8'});}

test('new accepts options before directory and aligns explicit duration',()=>{
  const directory=path.join(temp,'custom');
  const r=run('new.mjs',['--title','我的频道','--duration','1.25',directory]);
  assert.equal(r.status,0,r.stderr);
  assert.match(fs.readFileSync(path.join(directory,'index.html'),'utf8'),/duration: Number\(Q\.get\('d'\)\) \|\| 1\.25/);
  assert.match(fs.readFileSync(path.join(directory,'notes.md'),'utf8'),/时长：1\.25s/);
  assert.match(fs.readFileSync(path.join(directory,'index.html'),'utf8'),/<title>我的频道<\/title>/);
});
test('default project is eight seconds and retains stage license',()=>{
  const directory=path.join(temp,'default');const r=run('new.mjs',[directory]);assert.equal(r.status,0,r.stderr);
  const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
  assert.match(html,/duration: Number\(Q\.get\('d'\)\) \|\| 8/);assert.ok(html.includes('MIT License'));
  assert.match(fs.readFileSync(path.join(directory,'notes.md'),'utf8'),/时长：8s/);
  assert.ok(fs.existsSync(path.join(directory,'CREDITS.md')));assert.ok(fs.existsSync(path.join(directory,'THIRD_PARTY_LICENSES.txt')));
});
test('new refuses overwrite without modifying prior source',()=>{
  const directory=path.join(temp,'default');const before=fs.readFileSync(path.join(directory,'index.html'));
  const r=run('new.mjs',[directory,'--duration','2']);assert.notEqual(r.status,0);
  assert.deepEqual(fs.readFileSync(path.join(directory,'index.html')),before);
});
test('invalid or incomplete new options fail before writing a project',()=>{
  for(const args of [['--duration','NaN'],['--duration','0'],['--title'],['--unknown','value']]){
    const directory=path.join(temp,'invalid');const r=run('new.mjs',[directory,...args]);assert.notEqual(r.status,0,args.join(' '));assert.ok(!fs.existsSync(directory));
  }
});
test('renderer rejects invalid fps and times before browser launch',()=>{
  const html=path.join(root,'assets/stage.html');
  for(const args of [['--fps','25'],['--duration','0'],['--stills','oops'],['--no-encode'],['--poster','-1']]){
    const r=run('render.mjs',['--html',html,...args]);assert.equal(r.status,2,r.stderr);
  }
});
test('validator rejects missing or invalid media',()=>{
  assert.notEqual(run('validate.mjs',[path.join(temp,'missing.mp4')]).status,0);
  assert.notEqual(run('validate.mjs',['--duration','NaN']).status,0);
});
test('release scope excludes private projects and unverified raw library',()=>{
  const report=inspectRelease();assert.deepEqual(report.failures,[]);
  assert.ok(report.files.includes('library/README.md'));
  assert.ok(report.files.every(f=>!f.startsWith('projects/')&&(!f.startsWith('library/')||f==='library/README.md')));
  assert.ok(report.files.includes('scripts/lib/runtime.mjs'));
});
test('release rejects unknown flags and destinations outside dist',()=>{
  assert.notEqual(run('release.mjs',['--unknown']).status,0);
  assert.throws(()=>prepareRelease(path.join(temp,'outside-release')),/dist/);
});
test('prepared core can create a project without the optional library',()=>{
  const dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});releaseTemp=fs.mkdtempSync(path.join(dist,'release-test-'));
  const directory=path.join(releaseTemp,'prepared'),report=prepareRelease(directory);
  assert.ok(report.files.length>15);
  assert.deepEqual(fs.readdirSync(path.join(directory,'library')),['README.md']);
  const result=spawnSync(process.execPath,[path.join(directory,'scripts/new.mjs'),'out/new-film'],{cwd:directory,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.ok(fs.existsSync(path.join(directory,'out/new-film/index.html')));
  assert.throws(()=>prepareRelease(directory),/已存在/);
});
