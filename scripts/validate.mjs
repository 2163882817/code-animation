#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertRuntime,findFfmpeg,findFfprobe} from './lib/runtime.mjs';

try{
  assertRuntime();
  const options={},files=[];
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--audio-required'||a==='--json')options[a]=true;
    else if(a.startsWith('--')){
      if(!['--duration','--fps','--width','--height'].includes(a))throw Error('未知参数：'+a);
      const n=Number(args[++i]);if(!Number.isFinite(n)||n<=0)throw Error(a+' 需要正数');options[a]=n;
    }else files.push(a);
  }
  if(files.length>1)throw Error('只能验证一个文件');
  const file=path.resolve(files[0]||'out/video.mp4');if(!fs.existsSync(file))throw Error('找不到文件：'+file);
  const ffmpeg=findFfmpeg(),ffprobe=findFfprobe(ffmpeg);if(!ffmpeg||!ffprobe)throw Error('需要完整 FFmpeg 与 FFprobe；请运行 doctor.mjs');
  const probe=spawnSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'});
  if(probe.status!==0)throw Error('无法读取媒体信息：'+(probe.stderr||'FFprobe 运行失败').trim());
  const info=JSON.parse(probe.stdout),video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');
  const fraction=video?.avg_frame_rate?.split('/').map(Number)||[];
  const fps=fraction[1]?fraction[0]/fraction[1]:0;
  const duration=Number(video?.duration??info.format.duration);
  const rows=[];const add=(ok,name,detail)=>rows.push({ok:!!ok,name,detail});
  add(video,'视频流',video?video.codec_name+' / '+video.pix_fmt:'缺失');
  add(!options['--audio-required']||audio,'音轨',audio?audio.codec_name+' / '+audio.sample_rate+'Hz / '+audio.channels+'ch':'无');
  if(options['--width'])add(video?.width===options['--width'],'宽度',video?.width);
  if(options['--height'])add(video?.height===options['--height'],'高度',video?.height);
  if(options['--fps'])add(Math.abs(fps-options['--fps'])<.01,'帧率',fps);
  if(options['--duration'])add(Number.isFinite(duration)&&Math.abs(duration-options['--duration'])<=1/(options['--fps']||fps||24)+.01,'时长',duration);
  if(!options['--duration'])add(Number.isFinite(duration)&&duration>0,'时长',duration);
  const decoded=spawnSync(ffmpeg,['-hide_banner','-xerror','-i',file,'-vf','blackdetect=d=0.30:pix_th=0.10','-f','null','-'],{encoding:'utf8',maxBuffer:8*1024*1024});
  add(decoded.status===0,'完整解码',decoded.status===0?'通过':(decoded.stderr||'运行失败').slice(-700));
  const blacks=[...(decoded.stderr||'').matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map(m=>({start:Number(m[1]),end:Number(m[2])}));
  add(decoded.status===0&&blacks.length===0,'黑场',blacks.length?blacks:'无 ≥0.3s 黑场');
  const report={file,bytes:fs.statSync(file).size,checks:rows,pass:rows.every(r=>r.ok)};
  if(options['--json'])console.log(JSON.stringify(report,null,2));
  else{for(const row of rows)console.log(`${row.ok?'PASS':'FAIL'} ${row.name}: ${typeof row.detail==='object'?JSON.stringify(row.detail):row.detail}`);console.log(report.pass?'PASS':'FAIL');}
  if(!report.pass)process.exitCode=1;
}catch(e){console.error('[validate] '+e.message);process.exitCode=1;}
