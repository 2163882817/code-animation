# 在 GitHub 发布

## 发布范围

默认发布核心代码、工作流、风格组合摘要、模板和整理后的示例。未核验的资料库原文和图片、个人 projects、环境依赖、缓存及中间音视频不进入公开包。

`.gitignore` 只影响尚未跟踪的文件。若以后已有 Git 历史，要同时检查已跟踪文件；忽略规则不会删除历史中的私密内容。当前准备脚本采用固定文件范围，避免把整个工作目录直接打包。

## 本地验收

1. 检查 LICENSE 的版权署名与授权范围，确认自有文件来源；第三方材料按 SOURCES.md 逐项记录。
2. 运行 `node scripts/doctor.mjs`，然后运行 `npm test` 和 `npm run check`。
3. 依照 README 从零创建一个项目，导出至少三张静帧、查看图片，再渲染和验证 MP4。对示例的修改也执行同样的检查。
4. 运行 `node scripts/release.mjs --check`，确认文档链接与公开文件范围。
5. 运行 `node scripts/release.mjs`，得到 `dist/code-animation-studio-core-<版本>/`。已存在的同名目录不会被覆盖；需要重新准备时选择一个新的 `--out` 目录。
6. 从该发布目录再次执行快速开始，确认未携带可选风格库仍可运行。

## 上传到 GitHub

在 GitHub 创建仓库后，可以上传准备好的核心目录内容作为仓库根目录。若使用 Git 命令，先检查暂存文件列表，避免上传本地资料库、密钥、个人路径与制作缓存。保留 LICENSE、LICENSE-SCOPE.md、SOURCES.md 和 library/README.md。

GitHub 的许可证识别通常会显示 MIT。由于仓库已包含 LICENSE，创建仓库时无需再生成另一份。MIT 允许商业使用和闭源集成，保留版权与许可声明是使用条件；第三方内容遵守其原许可。

发布标签应与 VERSION、package.json 和 CHANGELOG 一致。可将演示视频放到 GitHub Release，再把真实地址补到 README；没有实际上传前不要编造下载链接。

## 外部材料的后续加入

授权核验属于维护者责任，自动化检查不能替代。新增公开材料时，同时调整 SOURCES.md、忽略规则、发布范围和 README 的实际资源数量；只保留参考链接不表示已经获得文本或图片的分发许可。

发布脚本只准备本地目录，不会创建远程仓库、提交代码、推送或公开发布。
