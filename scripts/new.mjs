#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRuntime} from './lib/runtime.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
  assertRuntime();
  const args=process.argv.slice(2),options={},positional=[];
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--help'){console.log('node scripts/new.mjs <directory> [--title "标题"] [--duration 8]');process.exit(0);}
    if(a.startsWith('--')){
      if(!['--title','--duration'].includes(a))throw Error(`未知参数：${a}`);
      const value=args[++i];if(!value||value.startsWith('--'))throw Error(`${a} 缺少值`);options[a]=value;
    }else positional.push(a);
  }
  if(positional.length>1)throw Error('只能指定一个项目目录');
  const duration=Number(options['--duration']??8);
  if(!Number.isFinite(duration)||duration<=0)throw Error('--duration 必须是正数秒数');
  const target=path.resolve(positional[0]||'film'),title=options['--title']||path.basename(target);
  const files=['index.html','notes.md','CREDITS.md','THIRD_PARTY_LICENSES.txt'];
  for(const file of files)if(fs.existsSync(path.join(target,file)))throw Error(`已存在，不覆盖：${path.join(target,file)}`);
  const license=fs.readFileSync(path.join(ROOT,'LICENSE'),'utf8');
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  let stage=fs.readFileSync(path.join(ROOT,'assets/stage.html'),'utf8');
  stage=stage.replace('<title>Code Animation Stage</title>',`<title>${escape(title)}</title>`)
    .replace(/duration: Number\(Q\.get\('d'\)\) \|\| \d+/,`duration: Number(Q.get('d')) || ${duration}`)
    .replace('<!doctype html>','<!doctype html>\n<!--\nCanvas stage code license:\n'+license+'\n-->');
  const n=t=>Number((duration*t).toFixed(3));
  const notes=`# ${title}\n\n## 制作方案\n主题：请填写。风格：请填写。签名镜头：请填写。\n\n## 规格\n- 画幅：1920×1080\n- 帧率：24fps\n- 时长：${duration}s\n- 音轨：无\n\n## 色板与字体\n纸 #F2E9D2，墨 #141414，强调 #F6C23E；Georgia 与系统中文字体。\n\n## 分镜\n| 时间 | 画面与动作 | 声音 |\n|---|---|---|\n| 0–${n(.2)}s | 建立主题 | 待定 |\n| ${n(.2)}–${n(.5)}s | 展开主要信息 | 待定 |\n| ${n(.5)}–${n(.8)}s | 变化与转折 | 待定 |\n| ${n(.8)}–${duration}s | 落版 | 待定 |\n\n## 检查记录\n填写已执行的命令、看图结果与已知限制。默认舞台仍是示例，请先改写 SCENE。\n`;
  const credits=`# 素材来源\n\n- Canvas 舞台代码：Code Animation Studio contributors，MIT，许可全文见 THIRD_PARTY_LICENSES.txt；HTML 中保留相同许可。\n- 本项目新增的文案、图形与素材：请填写来源及作者。\n- 字体：系统字体，无随附字体文件。\n- 音乐与配音：当前无。添加时记录服务、作者和使用条件。\n`;
  fs.mkdirSync(path.join(target,'out'),{recursive:true});
  fs.writeFileSync(path.join(target,'index.html'),stage);
  fs.writeFileSync(path.join(target,'notes.md'),notes);
  fs.writeFileSync(path.join(target,'CREDITS.md'),credits);
  fs.writeFileSync(path.join(target,'THIRD_PARTY_LICENSES.txt'),license);
  console.log(`[new] ${target} · ${duration}s · 1920×1080 / 24fps`);
  console.log('[new] 编辑 index.html 的 SCENE，填写 notes.md 与 CREDITS.md，再导出关键帧。');
}catch(e){console.error(`[new] ${e.message}`);process.exitCode=1;}
