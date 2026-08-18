# dsh-cpa-status

[CLIProxyAPI（CPA）](https://github.com/router-for-me/CLIProxyAPI) 的 DeepSeek Harness 状态面板插件：侧栏常驻状态灯，点开即看账号池配额、健康与流量——不用每次开 CPA 管理页。

- **收起态**：`● CPA · 3/3 账号 · 28 次/30min`，成功率异常或账号缺员时自动变色告警
- **账号卡**：套餐徽章（含订阅剩余天数）、指标宫格（请求总数 / 成功率 / 近 30 分钟）、健康刻度带（约 3.3 小时逐 10 分钟成败）、配额进度条（剩余 % + 重置倒计时）
- **AI 供应商页**：api-key 网关列表（类型 / 地址 / 模型 / 密钥末四位 / 启停），与认证文件分页签切换
- **配额手动同步**：点「同步配额」才探测上游（codex / kimi / xai 已实测），平时只读 CPA 本地数据
- **非侵入**：不碰 usage 队列、不写 CPA 数据；密钥仅存本机凭据库，网关密钥只显示末四位

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-cpa-status && dsh web   # 重启生效
```

## 配置

点侧栏「连接 CPA」，填两项：

- **Base URL**：CPA 地址，如 `http://127.0.0.1:8317`；反代场景填到子路径根（`https://example.com/abc123`）
- **Management Key**：CPA 管理密钥，仅存本机凭据库

Public URL 可选（「管理页 ↗」外链，默认 `{Base URL}/management.html`）。亦可用环境变量 `CPA_BASE_URL` / `CPA_MANAGEMENT_KEY` 预置（env 注入时表单密钥只读）。
