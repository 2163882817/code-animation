#!/usr/bin/env node
/**
 * check.mjs — 渲染前静态检查。30 秒内发现 80% 的"渲染出来才发现"的问题。
 *
 * 用法：node scripts/check.mjs index.html [--width 1920] [--height 1080]
 * 退出码：0 = 通过（可能有警告），1 = 有错误。
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const file = path.resolve(args.find(a => !a.startsWith('--')) || 'index.html');
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const W = getArg('--width', 1920);
const H = getArg('--height', 1080);

if (!fs.existsSync(file)) {
  console.error(`找不到文件：${file}`);
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const code = raw
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const results = [];
const add = (level, id, msg, hint = '') => results.push({ level, id, msg, hint });
const has = re => re.test(code);

/* ---------- 结构 ---------- */
if (!/<meta[^>]+charset\s*=\s*["']?utf-8/i.test(raw)) add('error', 'charset', '缺少 <meta charset="utf-8">', '中文会变乱码');
if (!/<canvas[\s>]/i.test(code)) add('error', 'canvas', '没有 <canvas> 元素');
const cw = code.match(/<canvas[^>]*\bwidth\s*=\s*["']?(\d+)/i);
const ch = code.match(/<canvas[^>]*\bheight\s*=\s*["']?(\d+)/i);
if (cw && Number(cw[1]) !== W) add('warn', 'canvas-w', `<canvas width> 是 ${cw[1]}，期望 ${W}`, '由 CFG 设置也可');
if (ch && Number(ch[1]) !== H) add('warn', 'canvas-h', `<canvas height> 是 ${ch[1]}，期望 ${H}`, '由 CFG 设置也可');
if (!has(/window\.__setTime/)) add('error', 'settime', '没有 window.__setTime(t) 渲染接口', '从 assets/stage.html 复制播放器');
if (!has(/function\s+draw|drawScene|const\s+draw\s*=/)) add('warn', 'draw', '没找到 draw/drawScene 函数');

/* ---------- 确定性 ---------- */
if (has(/Math\.random\s*\(/)) add('error', 'random', '使用了 Math.random()', '改用 mulberry32(seed)');
if (has(/\bDate\.now\s*\(|\bnew\s+Date\s*\(/)) add('error', 'date', '使用了 Date.now() / new Date()', '画面必须只依赖 t');
if (has(/performance\.now\s*\(/)) add('warn', 'perf', '使用了 performance.now()', '只允许播放器计时，不允许场景使用');
if (has(/\bsetTimeout\s*\(|\bsetInterval\s*\(/)) add('warn', 'timer', '使用了 setTimeout/setInterval', '动画应由 t 驱动');
if (has(/@keyframes|transition\s*:/)) add('warn', 'css-anim', 'CSS 动画/过渡', '渲染逐帧截图时 CSS 动画不可控');

/* ---------- 离线与资源 ---------- */
if (has(/(?:src|href)\s*=\s*["']https?:/i) || has(/@import\s+url\(/i) || has(/fetch\s*\(\s*["']https?:/i)) {
  add('error', 'external', '引用了外部网络资源', '字体/图片必须本地或系统字体');
}
if (has(/new\s+Image\s*\(\s*\)[\s\S]{0,80}\.src\s*=\s*["'](?!data:)/)) {
  add('warn', 'image', '动态加载图片', '确认渲染前已 onload，或改为程序绘制');
}

/* ---------- 交付完整性 ---------- */
if (/TODO|FIXME|其余同上|此处略|\.\.\.\s*$/m.test(code)) {
  add('error', 'placeholder', '代码里有占位内容（TODO / 省略号 / 其余同上）', '必须完整可运行');
}
const dur = code.match(/duration\s*:/);
if (!dur) add('warn', 'duration', '没找到 duration 配置');

/* ---------- 输出 ---------- */
const errors = results.filter(r => r.level === 'error');
const warns = results.filter(r => r.level === 'warn');
const icon = { error: '✗', warn: '!' };
for (const r of results) {
  console.log(`${icon[r.level]} [${r.id}] ${r.msg}${r.hint ? `  → ${r.hint}` : ''}`);
}
console.log(`\n${errors.length} error(s), ${warns.length} warning(s)  ·  ${path.basename(file)}`);
process.exit(errors.length ? 1 : 0);
