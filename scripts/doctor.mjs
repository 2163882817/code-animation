#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {assertRuntime,findChrome,findFfmpeg,findFfprobe,hasLibx264} from './lib/runtime.mjs';
try{assertRuntime();}catch(e){console.error(e.message);process.exit(1);}
const chrome=findChrome(),ffmpeg=findFfmpeg(),ffprobe=findFfprobe(ffmpeg);
const encoders=ffmpeg?spawnSync(ffmpeg,['-hide_banner','-encoders'],{encoding:'utf8'}):null;
const probe=ffprobe?spawnSync(ffprobe,['-version'],{encoding:'utf8'}):null;
const rows=[
  {name:'Node.js',ok:true,detail:process.version},
  {name:'Chrome / Edge',ok:!!chrome,detail:chrome||'未找到；设置 CHROME_PATH'},
  {name:'FFmpeg libx264',ok:!!ffmpeg&&hasLibx264(ffmpeg),detail:ffmpeg||'未找到；设置 FFMPEG_PATH'},
  {name:'AAC encoder',ok:!!encoders&&encoders.status===0&&/\baac\s/.test(encoders.stdout),detail:'有音轨时使用'},
  {name:'FFprobe',ok:!!probe&&probe.status===0,detail:ffprobe||'未找到；设置 FFPROBE_PATH'}
];
if(process.argv.includes('--json'))console.log(JSON.stringify({pass:rows.every(x=>x.ok),checks:rows},null,2));
else{for(const row of rows)console.log(`${row.ok?'PASS':'FAIL'} ${row.name}: ${row.detail}`);console.log('字体、浏览器启动权限和画面仍需通过实际关键帧检查。');}
if(rows.some(x=>!x.ok))process.exitCode=1;
