# 更新日志 (Changelog)

本项目所有规则转换相关的变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **远程运行时季集表**：转换器将可安全识别的有限范围季集规则输出到 `Word/season-candidates.txt`；正则、偏移和开放规则直接过滤，避免误生效。
- **移除候选报告生成**：转换器最终只生成 `2026.txt` 与 `season-candidates.txt` 两个运行时 TXT。
- **移除 `auto-match.txt` 生成**：当前运行时只使用 `season-candidates.txt`，转换器不再生成无用的兼容文件。

- **增量转换机制**：转换脚本首次全量转换后，在 `Source/.converter-cache/` 保存每个源文件的内容哈希与转换结果
  - 后续执行只重新转换新增或内容变化的源文件，未变化的直接复用缓存，显著减少转换耗时
  - 最终仍完整重写 `Word/2026.txt` 与 `Word/season-candidates.txt`，不会残留已删除的旧规则
  - 转换脚本版本或规则逻辑变化时自动使缓存失效并全量重建
- **上游地址配置迁移**：可抓取的上游词表地址由根目录 `sources.txt` 迁移到 `Source/source.txt`，并补充填地址示例注释
- **README 致谢部分**：新增对上游项目 [MoviePilot-Help](https://github.com/Putarku/MoviePilot-Help) 及维护者 `Putarku` 的致谢

### 变更

- 自动更新工作流改为读取 `Source/source.txt`（GitHub Actions 每天北京时间 05:00 执行）；
  - `sources.txt` 已删除，迁移完成
- 增量转换缓存目录 `Source/.converter-cache/` 会随转换结果一起提交，供 Action 下次运行复用
