#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRuntime} from './lib/runtime.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROOT_FILES=['README.md','SKILL.md','SOURCES.md','CONTRIBUTING.md','LICENSE','LICENSE-SCOPE.md','VERSION','CHANGELOG.md','RELEASING.md','package.json','.gitignore','.gitattributes','.nvmrc','library/README.md'];
const TREES=['assets','scripts','references','templates','tests','.github','examples/biennale-yellow','docs/media'];
function walk(relative){
  const absolute=path.join(ROOT,relative);
  if(!fs.existsSync(absolute))return [];
  if(fs.lstatSync(absolute).isSymbolicLink())throw Error('公开文件范围中不允许符号链接：'+relative);
  if(fs.statSync(absolute).isFile())return [relative.replaceAll('\\','/')];
  return fs.readdirSync(absolute).sort().flatMap(name=>walk(path.join(relative,name)));
}
export function inspectRelease(){
  const version=fs.readFileSync(path.join(ROOT,'VERSION'),'utf8').trim();
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('VERSION 必须为三段版本号');
  const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  if(pkg.version!==version)throw Error('VERSION 与 package.json 不一致');
  const files=[...new Set([...ROOT_FILES,...TREES.flatMap(walk)])].sort();
  const publicSet=new Set(files),failures=[];
  for(const file of files){
    const absolute=path.join(ROOT,file);
    if(!fs.existsSync(absolute)){failures.push('缺少文件：'+file);continue;}
    if(fs.lstatSync(absolute).isSymbolicLink()){failures.push('不应公开符号链接：'+file);continue;}
    if(/(^|\/)(node_modules|projects|\.voice-runtime|\.frames[^/]*|\.env)(\/|$)/.test(file)||(/^(library\/)/.test(file)&&file!=='library/README.md'))failures.push('不应公开的文件：'+file);
    if(!/\.(md|mjs|js|html|json|ya?ml)$/.test(file))continue;
    const text=fs.readFileSync(absolute,'utf8');
    if(/[A-Za-z]:[\\/]Users[\\/][^\s"'<>]+/.test(text)||/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))failures.push('发现个人路径或私钥标记：'+file);
    if(file.endsWith('.md'))for(const m of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
      let target=m[1].split('#')[0].replace(/^<|>$/g,'');
      if(!target||/^(https?:|mailto:)/.test(target))continue;
      target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(target)));
      if(!publicSet.has(target))failures.push('链接目标不在发布包：'+file+' -> '+target);
    }
  }
  return {version,files,failures,bytes:files.reduce((n,f)=>n+(fs.existsSync(path.join(ROOT,f))?fs.statSync(path.join(ROOT,f)).size:0),0)};
}
export function prepareRelease(target){
  const report=inspectRelease();if(report.failures.length)throw Error(report.failures.join('\n'));
  const dist=path.resolve(ROOT,'dist'),destination=path.resolve(target||path.join(dist,'code-animation-studio-core-'+report.version));
  const rel=path.relative(dist,destination);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('发布目录必须位于 dist 的子目录');
  if(fs.existsSync(destination))throw Error('发布目录已存在，不覆盖；请指定 dist 下新的 --out 目录');
  for(const file of report.files){const to=path.join(destination,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(ROOT,file),to);}
  fs.writeFileSync(path.join(destination,'RELEASE-MANIFEST.json'),JSON.stringify({version:report.version,edition:'core',files:report.files,excluded:['projects/','unverified library originals and previews','local dependencies and caches']},null,2));
  return {...report,destination};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assertRuntime();const args=process.argv.slice(2),index=args.indexOf('--out');
    if(args.some((x,i)=>x!=='--check'&&x!=='--out'&&!(index>=0&&i===index+1))||index>=0&&(!args[index+1]||args[index+1].startsWith('--')))throw Error('用法：node scripts/release.mjs [--check] [--out dist/新目录]');
    const report=args.includes('--check')?inspectRelease():prepareRelease(index>=0?args[index+1]:undefined);
    if(report.failures.length)throw Error(report.failures.join('\n'));
    console.log(JSON.stringify({pass:true,version:report.version,files:report.files.length,MiB:Number((report.bytes/1048576).toFixed(2)),destination:report.destination||null,scope:'core only; licensing provenance still requires maintainer review'},null,2));
  }catch(e){console.error('[release] '+e.message);process.exitCode=1;}
}
