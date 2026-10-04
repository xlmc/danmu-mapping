# 社区映射规则上传

## 流程

用户在 danmu_api 的配置页勾选已保存的本地规则，点“上传共享”：

danmu_api 管理接口 → Cloudflare Worker → Word/submissions/<SHA256>.json（待核验）
→ 社区审核脚本 → Word/community/accepted.json（已核验）
→ 现有转换任务 → Word/2026.txt / Word/season-candidates.txt。

用户不需要 GitHub 登录、Token、PR 或 Issue。只有维护者进行下面的一次性配置。
这些是 GitHub 仓库 Word 目录中的文件，不是 Microsoft Word 文档。

## 一次性上线

1. 安装本补丁到 xlmc/danmu-mapping/main，并在 xlmc/danmu_api 部署新版客户端。
   不要把上传凭证写进两个仓库或客户端环境变量。
2. 维护者创建 fine-grained GitHub Token：
   https://github.com/settings/personal-access-tokens/new
   Resource owner 选择 xlmc；Repository access 仅选择 danmu-mapping；
   Repository permissions → Contents → Read and write；设置有效期。
   此 Token 只用于接收规则，不需要 Workflows 权限。
   如果通过另一个 GitHub 凭证安装 .github/workflows 代码，该安装凭证需允许编辑工作流；
   不应因此扩大接收端 Token 的权限。
3. Cloudflare 控制台 → Workers & Pages → danmu-rules-upload → Settings → Variables and Secrets：
   新增 Secret GITHUB_TOKEN，填入上一步的值（不要在聊天里粘贴）。
   IP_LIMITER 与 WRITE_LIMITER 绑定已由本次部署建立。
4. 确认两边代码已安装、测试通过后，再把普通变量 UPLOADS_ENABLED 从 false 改为 true 并部署。
5. GET https://danmu-rules-upload.cbzj.workers.dev/health 应显示 uploads_enabled:true。
   用一条确实正确、允许公开的本地规则上传，确认 GitHub 出现对应 pending_review 文件，
   且运行时表在审核前不变。然后完成审核与转换，再检查公开运行时表及 danmu_api 远程刷新。
   这一步是线上端到端验收，不可由本地模拟测试替代。

重新部署 Worker（在本目录下运行）：

```sh
npx wrangler deploy --config upload-worker/wrangler.jsonc
npx wrangler secret put GITHUB_TOKEN --config upload-worker/wrangler.jsonc
```

wrangler.jsonc 默认 UPLOADS_ENABLED=false，重新按默认配置部署会关闭上传。
启用应显式修改此变量，不要仅因添加 Secret 就开启接收。
Cloudflare Token 只用于维护部署；GitHub Token 只存 Worker Secret。

## 审核

默认自动任务只生成校验报告，结构有效并不等于作品/平台/集数正确。
也可本地执行：

```sh
node --test tests/*.test.mjs
node review-community.mjs --word Word --report community-review.json
node review-community.mjs --word Word --approve 提交ID --confirm-reviewed --report community-review.json
```

接纳前须核对真实作品、目标弹幕平台、季集范围、偏移、发布组条件。
存在结构错误、同条件不同目标、重叠区间偏移冲突或标题循环时，不允许接纳。
多个待核验提交之间也会比较冲突；冲突的双方都被阻止。
哈希与文件内容不一致会阻止审核。所有指定接纳批次检查完成后才写 accepted.json。

GitHub Actions → Review community submissions → Run workflow：
留空 approve_ids 只生成报告；确认真实映射后填写逗号分隔的 ID，并勾 confirm_reviewed。
审核后可手动运行现有 Convert MoviePilot words，或等待其现有定时任务。
审核工作流不是自动业务审批，也不立即触发转换。

维护者既有 my-words.txt / auto-match-draft.txt 的优先权不变。
社区规则不得覆盖当前不同目标的标题规则。转换发现季集冲突会停止，保留旧运行时表。
待审核文件不会被转换器读取。重复接纳不会重复增加 accepted.json。
原始提交保留作审计；已接纳/已发布后报告可能显示 duplicate_only。

## 协议和边界

- POST /api/rules/submit，仅 version=1 和 rules 数据；最多 100 条、请求体 64 KiB。
- title：原始标题 -> 目标标题。
- season：作品 S2E1~E12 -> 平台作品 S1E13~E24 @tencent。
  支持无上界起点及字面量 {[group=Foo|Bar]} 条件；开放映射按更保守的重叠检查处理。
- 不接受正则执行、MoviePilot 表达式、脚本、任意地址、任意仓库路径或其他客户端配置。
  本地高级规则可能不在这个受限共享语法内，返回“不支持”，但不更改本地规则。
- 规范化后按标题、范围、平台、发布组、目标去重；完全相同规范规则集合以哈希标识重试。
  Worker 对已发布表去重；不同批次待审核内容不在接收端做全量扫描，交给审核阶段比较。
- 不支持的旧已发布语法不参与接收端校验，转换阶段仍用原有冲突检查保护发布。
- 源规则经当前保存配置和索引核对，拒绝旧页面的过期选择。
  不上传 danmu_api 用户/管理员 Token、cookie、其他配置或本地路径。
- IP_LIMITER：每来源 IP 每分钟 6 次；WRITE_LIMITER：每分钟 12 次。
  Cloudflare 计数是按边缘位置的近似限流，并非严格全局配额/完整防滥用保障。
  来源 IP 是 danmu_api 的请求出口，可能是共享部署的 IP，不能宣称为每个最终用户独立限流。
  Worker 是公开入口，不可把客户端隐蔽值当作认证；无登录方案仍可能遭到垃圾提交。
- 转发不修改本地规则；上传成功只表示收集到了候选，不表示公共映射已经更新。
- GitHub 仓库 Contents 写权限不能按目录进一步限定；Worker 源码固定仓库和 Word/submissions 路径。

## 当前状态（2026-10-04）

danmu-rules-upload 已通过 Cloudflare API 部署，限流绑定和 false 开关已回读确认。
未配置 GITHUB_TOKEN，未启用接收，两个远程仓库尚未安装这些本地改动。
本机访问 workers.dev 的浏览器被客户端阻止，因此线上 HTTP /health 仍需在你的网络验收。
此前健康探针的截图只证明你当时能访问探针，不证明新服务上传端到端通过。
