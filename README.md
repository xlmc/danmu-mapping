# danmu-mapping

[danmu_api](https://github.com/nidb66/danmu_api) 的远程剧名映射表仓库,由 [MoviePilot 共享识别词](https://github.com/Putarku/MoviePilot-Help) 自动转换生成。

## 使用方法

在 danmu_api 环境变量中配置:

```
TITLE_MAPPING_TABLE_URL=https://raw.githubusercontent.com/xlmc/danmu-mapping/main/Word/2026.txt
```

国内网络可改用 jsDelivr CDN:

```
TITLE_MAPPING_TABLE_URL=https://cdn.jsdelivr.net/gh/xlmc/danmu-mapping@main/Word/2026.txt
```

## 文件说明

| 文件 | 用途 |
|---|---|
| `Word/2026.txt` | 「原始标题->映射标题」精确映射表,供 `TITLE_MAPPING_TABLE_URL` 拉取;含剥季/剥年后的裸标题变体,保证 match 场景(文件名解析剥离季/年)仍能命中 |
| `Word/season-candidates.txt` | 远程运行时季集表；包含人工实测的开放规则，以及自动识别的安全单集规则，供 `AUTO_MATCH_MAPPING_TABLE_URL` 拉取 |
| `Word/auto-match-draft.txt` | 人工确认清单；允许开放规则或等长有限范围，非注释规则会进入运行时季集表 |

`2026.txt` 与远程 `season-candidates.txt` 都来自同一批 MoviePilot 规则，但按规则能力分类生成。运行时采用成功即停止：标题缓存实际匹配成功后不再尝试季集缓存；标题失败时再尝试标题+季集组合及季集缓存。两个表允许同源键并存，只有实际匹配成功的路径才会终止后续尝试。

## 再生成

上游 MoviePilot 词表更新后,重新转换并提交:

```
node convert-moviepilot-words.mjs <上游词表文件...> --out Word
```

脚本首次执行时会全量转换，并在 `Source/.converter-cache/` 保存每个源文件的内容哈希和转换结果；后续执行只重新转换新增或内容发生变化的源文件，未变化的源文件直接复用缓存。最终只重新生成完整的 `Word/2026.txt` 和远程运行时 `Word/season-candidates.txt`，不安全候选直接过滤，不会残留已删除规则；转换脚本版本或规则逻辑变化时会自动使缓存失效并全量重建。工作流只发布这两个运行时表。

转换脚本会输出统计(标题映射数、裸标题变体数、剧名/年份/季组合键、歧义跳过数等);会剥离资源名中的画质、编码、音轨和制作组尾缀，并生成裸标题、标题+年份、标题+季等兼容键；同一裸键指向不同目标时自动跳过,目标含季区间(如 `黑镜S01-S05`)的裸键变体同样跳过。MoviePilot 正则、回溯引用和 EP 偏移不会自动发布为运行时规则；必须先改写到 `auto-match-draft.txt` 并完成人工验证。

## 自动更新(GitHub Action)

仓库已配置定时流水线(`.github/workflows/convert.yml`):每天北京时间 05:00 自动读取 `Source/source.txt` 中配置的地址，下载上游词表 → 转换 → 有变化则提交并刷新 jsDelivr CDN；也可在仓库 Actions 页面手动触发。danmu_api 侧不再使用缓存分钟配置：启动后读取本地缓存，每天北京时间 05:30 自动更新，失败最多重试 5 次。

**添加自己的词**:在 `Word/my-words.txt` 按上游语法写(`左侧 => 右侧`),Action 转换时自动并入且不会被上游更新覆盖;`Word/auto-match-draft.txt` 为季/集修正规则的人工整理稿,Action 不会改动它。

**配置抓取哪些上游**:编辑 `Source/source.txt`,每行一个地址——GitHub 目录页(自动抓全目录 txt)/GitHub 文件页(单文件)/任意 txt 直链,改完下次 Action 运行即生效。

## 致谢

感谢以下上游项目及维护者的持续维护与分享：

- [MoviePilot-Help](https://github.com/Putarku/MoviePilot-Help)
- 感谢上游维护者 [Putarku](https://github.com/Putarku) 维护 MoviePilot 共享识别词表
- 感谢所有参与词表补充、修正和维护的贡献者

本项目仅对上游词表进行转换和整理，原始规则及其维护权归上游项目及贡献者所有。
