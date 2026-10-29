import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function assertRuntime(){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<15)||typeof WebSocket!=='function')throw new Error('需要 Node.js 22.15+（含全局 WebSocket）；推荐 Node.js 24。');
}
export function exists(p){try{return !!p&&fs.statSync(p).isFile();}catch{return false;}}
export function onPath(name){
  const r=spawnSync(process.platform==='win32'?'where.exe':'which',[name],{encoding:'utf8'});
  return r.status===0?r.stdout.split(/\r?\n/).map(x=>x.trim()).filter(exists):[];
}
export function findChrome(){
  const candidates=[process.env.CHROME_PATH,process.env.PUPPETEER_EXECUTABLE_PATH,process.env.CHROME_BIN,
    path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
  const pw=process.platform==='win32'?path.join(process.env.LOCALAPPDATA||'','ms-playwright'):process.platform==='darwin'?path.join(os.homedir(),'Library/Caches/ms-playwright'):path.join(os.homedir(),'.cache/ms-playwright');
  try{for(const d of fs.readdirSync(pw))if(/^chromium(?:_headless_shell)?-\d+$/.test(d))for(const bin of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-mac/Chromium.app/Contents/MacOS/Chromium','chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium','chrome-linux/chrome','chrome-linux64/chrome','chrome-headless-shell-win64/chrome-headless-shell.exe','chrome-headless-shell-linux64/chrome-headless-shell'])candidates.push(path.join(pw,d,bin));}catch{}
  return candidates.find(exists)||null;
}
export function hasLibx264(ffmpeg){
  const r=spawnSync(ffmpeg,['-hide_banner','-encoders'],{encoding:'utf8'});
  return r.status===0&&/\blibx264\b/.test(r.stdout||'');
}
export function findFfmpeg(){
  const candidates=[process.env.FFMPEG_PATH,...onPath('ffmpeg'),
    path.join(ROOT,'node_modules/ffmpeg-static',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),
    'C:/ffmpeg/bin/ffmpeg.exe','C:/Program Files/ffmpeg/bin/ffmpeg.exe','/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg'];
  if(process.platform==='win32'){
    const packages=path.join(process.env.LOCALAPPDATA||'','Microsoft/WinGet/Packages');
    try{for(const d of fs.readdirSync(packages))if(/ffmpeg/i.test(d))for(const sub of fs.readdirSync(path.join(packages,d)))candidates.push(path.join(packages,d,sub,'bin/ffmpeg.exe'));}catch{}
    for(const v of ['1013','1011'])candidates.push(path.join(process.env.LOCALAPPDATA||'',`ms-playwright/ffmpeg-${v}/ffmpeg-win64.exe`));
  }
  const found=[...new Set(candidates.filter(exists))];
  return found.find(hasLibx264)||found[0]||null;
}
export function findFfprobe(ffmpeg=findFfmpeg()){
  return [process.env.FFPROBE_PATH,ffmpeg&&path.join(path.dirname(ffmpeg),process.platform==='win32'?'ffprobe.exe':'ffprobe'),...onPath('ffprobe')].find(exists)||null;
}
