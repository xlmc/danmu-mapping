# danmu-mapping

[danmu_api](https://github.com/xlmc/danmu_api) 的远程剧名映射表仓库,由 [MoviePilot 共享识别词](https://github.com/Putarku/MoviePilot-Help) 自动转换生成。

## 使用方法

在 danmu_api 环境变量中配置:

```
TITLE_MAPPING_TABLE_URL=https://raw.githubusercontent.com/xlmc/danmu-mapping/main/Word/2026.txt
AUTO_MATCH_MAPPING_TABLE_URL=https://raw.githubusercontent.com/xlmc/danmu-mapping/main/Word/season-candidates.txt
```

国内网络可改用 jsDelivr CDN:

```
TITLE_MAPPING_TABLE_URL=https://cdn.jsdelivr.net/gh/xlmc/danmu-mapping@main/Word/2026.txt
AUTO_MATCH_MAPPING_TABLE_URL=https://cdn.jsdelivr.net/gh/xlmc/danmu-mapping@main/Word/season-candidates.txt
```

## 文件说明

| 文件 | 用途 |
|---|---|
| `Word/2026.txt` | 「原始标题->映射标题」精确映射表,供 `TITLE_MAPPING_TABLE_URL` 拉取;含剥季/剥年后的裸标题变体,保证 match 场景(文件名解析剥离季/年)仍能命中 |
| `Word/season-candidates.txt` | 远程运行时季集表；包含人工确认的开放规则，以及自动识别的安全单集规则，供 `AUTO_MATCH_MAPPING_TABLE_URL` 拉取 |
| `Word/auto-match-draft.txt` | 人工确认清单；允许开放规则或等长有限范围，非注释规则会进入运行时季集表 |

`2026.txt` 与远程 `season-candidates.txt` 按规则能力分类生成。配套新版 danmu_api 在每一级配置内先尝试明确季集修正，再尝试仅替换标题；本机手动选择、本机配置仍优先于远程缓存。明确季集规则必须返回正确平台及集号；失败才回退标题或原始匹配。旧版本仍可能先使用标题表，建议先更新匹配端再启用新增国漫季集规则。

## 国漫场景

已补充神墓、永生、一念永恒、诛仙的英文/拼音别名及经过源站目录核对的季集区间。条件、目标平台和集数范围保留在规则中；不从发布组缺失的文件名猜测发布组。

| 输入 | 目标 |
|---|---|
| `Tomb.of.Fallen.Gods S02E01` | 优酷「神墓 辰南觉醒」第17集 |
| `IMMORTALITY S04E01` | B 站「永生」第41话 |
| `A.Will.Eternal S01E107` | 腾讯「一念永恒 第3季」第1集 |
| `Jade.Dynasty S02E01` | 腾讯「诛仙 第2季」第1集 |
| `Jade.Dynasty S01E27` + `ADWeb` | 腾讯「诛仙 第2季」第1集 |

`Source/guoman-evidence.json` 保存 2026-10-02 获取的目标目录、集标题和播放地址。有限规则不会延伸到范围外；特别篇及合集不根据普通集数偏移猜测。不同平台可声明独立的 `@平台` 规则；同条件冲突需要核对，不能靠声明顺序选择。

季集表可以在源侧声明可选发布组条件：

```
Oshi.no.Ko S03E01 {[group=ADWeb]} -> Oshi.no.Ko S01E03
```

转换器会把 MoviePilot 中可安全识别的 `(?=.*ADWeb)`、`(?<=ANi.*?)` 等字面发布组断言编译成这种标记。danmu_api 对带发布组的文件名先尝试同标题/季/集/组规则，再回退到同标题/季/集的通用规则；文件名没有发布组时只走通用规则。发布组不是必填条件，画质、编码、音轨和平台标记不会参与标题身份匹配。

## 再生成

上游 MoviePilot 词表更新后,重新转换并提交:

```
node convert-moviepilot-words.mjs <上游词表文件...> --out Word
```

脚本首次执行时会全量转换，并在 `Source/.converter-cache/` 保存每个源文件的内容哈希和转换结果；后续执行只重新转换新增或内容发生变化的源文件，未变化的源文件直接复用缓存。每次完整生成两个运行时表，并生成不参与匹配的 `Word/conversion-report.json` / `.md`。报告作为 Action 摘要和附件保存，不提交到词表；缓存复用时也重建报告。人工规则无效或同条件区间冲突会阻止覆盖运行时表。上游下载失败会停止发布，避免不完整下载删除有效词条。

转换脚本会输出统计并生成必要标题变体；同一裸键指向不同目标时自动跳过。明确标题别名链折叠到最终目标，已确认季集规则自动展开到同作品的英文/拼音别名；季号限定的别名不扩为全季身份。简单发布组单集规则可自动发布，复杂正则与 EP 偏移只生成核对候选，保留来源和完整原始条件。候选区间严格保留正则的不连续边界，不猜测上界；其表达的是 MoviePilot 的媒体识别关系，目标弹幕平台核对后才能加入 `auto-match-draft.txt`。

## 自动更新(GitHub Action)

仓库已配置定时流水线(`.github/workflows/convert.yml`):每天北京时间 05:00 自动读取 `Source/source.txt` 中配置的地址，下载上游词表 → 转换 → 有变化则提交并刷新 jsDelivr CDN；也可在仓库 Actions 页面手动触发。danmu_api 侧不再使用缓存分钟配置：启动后读取本地缓存，每天北京时间 05:30 自动更新，失败最多重试 5 次。

**添加自己的词**:在 `Word/my-words.txt` 按上游语法写(`左侧 => 右侧`)，转换器自动优先合并同名文件，相同键的人工修正覆盖上游；冲突保留在报告中。`Word/auto-match-draft.txt` 维护已确认季集关系，Action 不会改动它。

验证转换器：`node --test tests/*.test.mjs`。四部国漫的实际 `/match` 入口、缓存及源站目录快照回放测试位于配套 danmu_api 仓库的 `danmu_api/guoman-scenarios.test.js`。

**配置抓取哪些上游**:编辑 `Source/source.txt`,每行一个地址——GitHub 目录页(自动抓全目录 txt)/GitHub 文件页(单文件)/任意 txt 直链,改完下次 Action 运行即生效。

## 致谢

感谢以下上游项目及维护者的持续维护与分享：

- [MoviePilot-Help](https://github.com/Putarku/MoviePilot-Help)
- 感谢上游维护者 [Putarku](https://github.com/Putarku) 维护 MoviePilot 共享识别词表
- 感谢所有参与词表补充、修正和维护的贡献者

本项目仅对上游词表进行转换和整理，原始规则及其维护权归上游项目及贡献者所有。
