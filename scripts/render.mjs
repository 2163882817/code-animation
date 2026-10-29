#!/usr/bin/env node
/**
 * render.mjs — 把 index.html 逐帧渲染成 MP4。
 *
 * 原理：启动无头 Chrome，用 CDP 调 window.__setTime(t) 定格每一帧，
 * 截图后交给 ffmpeg 编码。画面完全由 t 决定，所以结果可复现。
 *
 * 用法：
 *   node scripts/render.mjs --html index.html --out out/video.mp4 --duration 8 --fps 24
 *   node scripts/render.mjs --html index.html --stills 0,2,4,6
 *   node scripts/render.mjs --html index.html --out out/video.mp4 --audio music.wav
 *
 * 依赖：Chrome/Edge（任意新版）、带 libx264 的 ffmpeg。
 * 环境变量：CHROME_PATH / FFMPEG_PATH 可指定路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertRuntime, findChrome, findFfmpeg, hasLibx264 } from './lib/runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { a[key] = next; i++; }
    else a[key] = true;
  }
  return a;
}
const args = parseArgs(process.argv);

const html = path.resolve(args.html || path.join(process.cwd(), 'index.html'));
const width = Number(args.width || 1920);
const height = Number(args.height || 1080);
const fps = Number(args.fps || 24);
const duration = Number(args.duration || 0); // 0 = 读取页面 CFG.duration
const outFile = path.resolve(args.out || path.join(process.cwd(), 'out', 'video.mp4'));
const stills = args.stills === undefined ? [] : String(args.stills).split(',').map(v => v.trim() === '' ? NaN : Number(v));
const poster = args.poster !== undefined ? Number(args.poster) : null;
const keepFrames = Boolean(args['keep-frames']);
const audio = args.audio ? path.resolve(args.audio) : null;
const noEncode = Boolean(args['no-encode']);

if (!fs.existsSync(html)) {
  console.error(`[render] 找不到 HTML：${html}`);
  process.exit(1);
}

try { assertRuntime(); } catch (err) { console.error(err.message); process.exit(2); }
if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || ![24, 30].includes(fps) || !Number.isFinite(duration) || duration < 0 || (args.duration !== undefined && duration <= 0) || stills.some(t => !Number.isFinite(t) || t < 0) || (poster !== null && (!Number.isFinite(poster) || poster < 0))) {
  console.error('[render] 参数错误：宽高须为正整数，fps 须为 24 或 30，时间须为有效非负秒数（duration 须为正数）。'); process.exit(2);
}
if (noEncode && !stills.length) { console.error('[render] --no-encode 需要 --stills 指定取帧时间。'); process.exit(2); }
if (audio && !fs.existsSync(audio)) { console.error('[render] 音频不存在：' + audio); process.exit(2); }
const chromePath = findChrome();
if (!chromePath) { console.error('[render] 找不到 Chrome / Edge。请安装浏览器或设置 CHROME_PATH。'); process.exit(2); }
const ffmpeg = noEncode ? null : findFfmpeg();
if (!noEncode && (!ffmpeg || !hasLibx264(ffmpeg))) { console.error('[render] 编码前检查失败：需要带 libx264 的 FFmpeg。请运行 doctor.mjs 或设置 FFMPEG_PATH。'); process.exit(2); }
let renderFramesDir;
/* ---------------- CDP 小客户端 ---------------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        const hs = this.handlers.get(msg.method) || [];
        hs.forEach(h => { try { h(msg.params); } catch { /* noop */ } });
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP 连接已断开'));
      this.pending.clear();
    });
  }
  static async connect(url, timeoutMs = 15000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 CDP 超时')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket 连接失败')); }, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, cb) {
    const arr = this.handlers.get(method) || [];
    arr.push(cb);
    this.handlers.set(method, arr);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(label, fn, timeoutMs = 20000, interval = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(interval);
  }
  throw new Error(`等待超时：${label}`);
}

/* ---------------- 启动浏览器 ---------------- */
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-chrome-'));
const portFile = path.join(profileDir, 'DevToolsActivePort');

const flags = [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--mute-audio',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${width},${height}`,
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-port=0',
  'about:blank',
];
if (process.env.CHROME_NO_SANDBOX === '1') flags.unshift('--no-sandbox');

const chrome = spawn(chromePath, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', d => { chromeErr += d.toString(); });
chrome.on('error', err => { console.error('[render] 启动浏览器失败：', err.message); });

async function closeBrowser() {
  try { await cdp?.send('Browser.close', {}, 3000); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  await sleep(400);
  try { if (path.dirname(profileDir) === path.resolve(os.tmpdir()) && path.basename(profileDir).startsWith('stage-chrome-')) fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function shutdown(code) {
  await closeBrowser();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));

let cdp;
try {
  const port = await waitFor('Chrome 调试端口', async () => {
    if (!fs.existsSync(portFile)) return null;
    const p = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    return Number.isFinite(p) && p > 0 ? p : null;
  }, 20000);

  const target = await waitFor('页面 target', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await res.json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
  }, 15000);

  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails || {};
    console.error(`\n[page error] ${d.text || ''} ${d.exception?.description || ''}`.trim());
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error' || p.type === 'warning') {
      const txt = (p.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      console.error(`\n[page ${p.type}] ${txt}`);
    }
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const url = pathToFileURL(html);
  url.searchParams.set('render', '1');
  if (args.duration !== undefined) url.searchParams.set('d', String(duration));
  if (args.width !== undefined) url.searchParams.set('w', String(width));
  if (args.height !== undefined) url.searchParams.set('h', String(height));
  url.searchParams.set('fps', String(fps));
  const loaded = new Promise(resolve => cdp.on('Page.loadEventFired', resolve));
  await cdp.send('Page.navigate', { url: url.href });
  await Promise.race([loaded, sleep(10000)]);

  // 等字体与舞台就绪
  await waitFor('页面初始化 (window.__stageReady)', async () => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'Boolean(window.__stageReady && window.__setTime)',
      returnByValue: true,
    });
    return r.result && r.result.value === true;
  }, 20000);

  // 读取页面里的时长/尺寸（命令行未指定时）
  let dur = duration;
  if (!dur) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__stage && window.__stage.CFG || {})',
      returnByValue: true,
    });
    try { dur = Number(JSON.parse(r.result.value).duration); } catch { dur = NaN; }
  }

  if (!Number.isFinite(dur) || dur <= 0) throw new Error('页面缺少有效的 CFG.duration；请设置时长。');
  if (stills.some(t => t > dur) || (poster !== null && poster > dur)) throw new Error('取帧时间超过片长。');
  const dimensions = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({width:document.querySelector("canvas").width,height:document.querySelector("canvas").height,duration:window.__stage.CFG.duration})', returnByValue:true });
  const actual = JSON.parse(dimensions.result.value);
  if (actual.width !== width || actual.height !== height) throw new Error('Canvas 尺寸与输出参数不一致；请先重排场景，再设置匹配的宽高。');
  if (Math.abs(Number(actual.duration)-dur) > 1/fps) throw new Error('页面 CFG.duration 与渲染时长不一致；请同步修改场景。');
  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });
  const framesDir = noEncode ? null : fs.mkdtempSync(path.join(outDir, '.frames-'));
  renderFramesDir = framesDir;

  const capture = async (t) => {
    const evaluated = await cdp.send('Runtime.evaluate', { expression: `window.__setTime(${Number(t)})`, returnByValue: true });
    if (evaluated.exceptionDetails) throw new Error('场景绘制异常：' + (evaluated.exceptionDetails.text || 'drawScene'));
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, 60000);
    return Buffer.from(shot.data, 'base64');
  };

  // 关键帧
  const stillDir = path.join(outDir, 'stills');
  if (stills.length) fs.mkdirSync(stillDir, { recursive: true });
  for (const t of stills) {
    const buf = await capture(t);
    const file = path.join(stillDir, `t_${t.toFixed(2)}.png`);
    fs.writeFileSync(file, buf);
    console.log(`[render] 静帧 ${file}`);
  }

  if (noEncode) {
    console.log('[render] --no-encode：只输出静帧。');
    await shutdown(0);
  }

  const frames = Math.max(1, Math.round(dur * fps));
  console.log(`[render] ${width}×${height} · ${fps}fps · ${dur}s → ${frames} 帧`);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    const buf = await capture(t);
    fs.writeFileSync(path.join(framesDir, `f_${String(i).padStart(5, '0')}.png`), buf);
    if (i % 10 === 0 || i === frames - 1) {
      const pct = Math.round((i + 1) / frames * 100);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`\r[render] ${pct}%  ${i + 1}/${frames}  ${sec}s   `);
    }
  }
  process.stdout.write('\n');

  if (poster !== null) {
    const buf = await capture(poster);
    fs.writeFileSync(path.join(outDir, 'poster.png'), buf);
    console.log(`[render] 海报帧 out/poster.png @ ${poster}s`);
  }

  await closeBrowser();
} catch (err) {
  console.error(`\n[render] 失败：${err.message}`);
  if (/Access is denied|0x5|mojo|platform_channel|named pipe/i.test(chromeErr)) {
    console.error('[render] 这通常是沙箱禁止浏览器使用命名管道。请在非沙箱环境运行，或允许该命令使用完整权限。');
  } else if (chromeErr.trim()) {
    console.error('[render] 浏览器输出：' + chromeErr.split(/\r?\n/).slice(-4).join('\n'));
  }
  await shutdown(3);
}

/* ---------------- 编码 ---------------- */
if (!ffmpeg) {
  console.error('[render] 帧已保存在 out/.frames，但找不到 ffmpeg。');
  console.error('  Windows: winget install --id Gyan.FFmpeg');
  console.error('  macOS:   brew install ffmpeg');
  console.error('  或设置 FFMPEG_PATH。装好后执行：');
  console.error(`  ffmpeg -framerate ${fps} -i "${path.join(path.dirname(outFile), '.frames', 'f_%05d.png')}" -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart "${outFile}"`);
  process.exit(4);
}
if (!hasLibx264(ffmpeg)) {
  console.error(`[render] ${ffmpeg} 不带 libx264，无法编码 MP4。`);
  console.error('  安装完整 ffmpeg：winget install --id Gyan.FFmpeg，或设置 FFMPEG_PATH。');
  process.exit(4);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const framesPattern = path.join(renderFramesDir, 'f_%05d.png');

function runFfmpeg(argv) {
  const r = spawnSync(ffmpeg, argv, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr?.split(/\r?\n/).slice(-12).join('\n'));
    throw new Error('ffmpeg 编码失败');
  }
}

const silent = path.join(path.dirname(outFile), '.silent.mp4');
runFfmpeg([
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(fps),
  '-i', framesPattern,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  silent,
]);

if (audio) {
  if (!fs.existsSync(audio)) {
    console.error(`[render] 音频不存在：${audio}`);
    process.exit(5);
  }
  runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', silent, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    // TP 留 -1.5：AAC 编码会过冲约 0.3–0.5 dB，交付仍能守住 -1 dBTP
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,apad',
    '-shortest', '-movflags', '+faststart',
    outFile,
  ]);
  fs.rmSync(silent, { force: true });
} else {
  fs.renameSync(silent, outFile);
}

if (!keepFrames) {
  const parent = path.resolve(path.dirname(outFile));
  if (path.dirname(path.resolve(renderFramesDir)) !== parent || !path.basename(renderFramesDir).startsWith('.frames-')) throw new Error('临时帧目录校验失败');
  fs.rmSync(renderFramesDir, { recursive: true, force: true });
} else console.log('[render] 临时帧目录：' + renderFramesDir);

const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
console.log(`[render] 完成：${outFile}  (${size} MB)`);
if (!audio) console.log('[render] 无音轨。需要声音时加 --audio。');
