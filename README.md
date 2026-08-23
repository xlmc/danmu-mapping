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
| `Word/season-candidates.txt` | 季数错位/集数偏移/正则类规则候选,需人工整理后配置到本地 `AUTO_MATCH_MAPPING_TABLE`,映射表无法表达此类规则 |

## 再生成

上游 MoviePilot 词表更新后,重新转换并提交:

```
node convert-moviepilot-words.mjs <上游词表文件...> --out Word
```

转换脚本会输出统计(标题映射数、裸标题变体数、剧名/年份/季组合键、歧义跳过数等);会剥离资源名中的画质、编码、音轨和制作组尾缀，并生成裸标题、标题+年份、标题+季等兼容键；同一裸键指向不同目标时自动跳过,目标含季区间(如 `黑镜S01-S05`)的裸键变体同样跳过。

## 自动更新(GitHub Action)

仓库已配置定时流水线(`.github/workflows/convert.yml`):每天北京时间 05:00 自动读取 `Source/source.txt` 中配置的地址，下载上游词表 → 转换 → 有变化则提交并刷新 jsDelivr CDN；也可在仓库 Actions 页面手动触发。danmu_api 侧不再使用缓存分钟配置：启动后读取本地缓存，每天北京时间 05:30 自动更新，失败最多重试 5 次。

**添加自己的词**:在 `Word/my-words.txt` 按上游语法写(`左侧 => 右侧`),Action 转换时自动并入且不会被上游更新覆盖;`Word/auto-match-draft.txt` 为季/集修正规则的人工整理稿,Action 不会改动它。

**配置抓取哪些上游**:编辑 `Source/source.txt`,每行一个地址——GitHub 目录页(自动抓全目录 txt)/GitHub 文件页(单文件)/任意 txt 直链,改完下次 Action 运行即生效。
