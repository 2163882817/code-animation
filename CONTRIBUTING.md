# 参与贡献

欢迎修正文档、补全来源记录、改进风格选型、添加可运行示例，以及修复渲染或检查脚本。

## 提交内容

一次提交围绕一个问题，说明修改目的、影响的文件和验证方式。涉及画面变化时，附关键帧或前后对比；涉及脚本行为时，附复现命令和结果。

- 修改风格条目时，保留已有 ID、参考链接和归属信息；新增条目同步更新 `references/style-atlas.md`。
- 修改制作流程时，同步检查 `SKILL.md`、相关参考文档和示例，避免相互矛盾。
- 新增示例时，提供 `index.html` 和 `notes.md`，记录规格、时间轴、主要实现决策和已知限制。
- 提交截图、日志或示例前，移除账号凭据、私人路径及未获授权的个人或项目信息。

## 来源记录

贡献自己有权提交的内容。引用或改写外部文本、图片、音乐和代码时，保留作者、来源及授权说明，并按 [SOURCES.md](SOURCES.md) 补充记录。无法确认分发权限时，先提交参考链接和说明。

项目自有代码与文档采用 MIT。提交原创贡献时，应确认有权按项目许可提交；第三方材料保持原许可并补齐 [来源与授权记录](SOURCES.md)。未核验的原文和图片不进入默认发布包，详见 [许可证范围](LICENSE-SCOPE.md)。

## 验证修改

仅修改文档时，检查命令、文件路径和相对链接是否准确，无需重新渲染视频。

代码修改先执行 `npm test` 与 `node scripts/release.mjs --check`。核心脚本没有 npm 运行依赖，无需执行 npm install。测试不会联网或启动浏览器；涉及渲染的更改还需执行下面的浏览器和成片验证。

修改舞台、示例或渲染流程时，在项目根目录按以下步骤验证，将路径替换为受影响的示例：

```bash
# 1. 静态检查
node scripts/check.mjs examples/biennale-yellow/index.html

# 2. 输出关键帧并查看画面
node scripts/render.mjs --html examples/biennale-yellow/index.html --stills 0,2.5,5,7.5 --no-encode --out ./out/review/video.mp4

# 3. 渲染并检查成片（8 秒示例）
node scripts/render.mjs --html examples/biennale-yellow/index.html --out ./out/review/video.mp4 --fps 24
node scripts/validate.mjs ./out/review/video.mp4 --duration 8 --fps 24 --width 1920 --height 1080
```

验证时保留确定性渲染约束：场景由时间 `t` 驱动，随机使用固定种子，不依赖上一帧的累积状态。不要提交临时逐帧截图、缓存或本地依赖目录。
