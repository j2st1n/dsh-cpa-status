# dsh-cpa-status

[CLIProxyAPI（CPA）](https://github.com/router-for-me/CLIProxyAPI) 的 DeepSeek Harness 状态面板：侧栏常驻状态灯，点开即看账号池配额、健康与流量——不用每次开 CPA 管理页。

## 功能

- **收起态**：`● CPA · 3/3 账号 · 28 次/30min`——健康时安静；成功率跌破 99% 或账号缺员才变色告警，无流量显示「空闲」
- **账号卡**（认证文件页）：提供商图标 + 套餐徽章（含订阅剩余天数）+ 指标宫格（请求总数 / 成功率 / 近 30 分钟）+ 健康刻度带（最近约 3.3 小时逐 10 分钟成败）+ 配额进度条（剩余 % + 重置倒计时）
- **AI 供应商页**：api-key 网关列表（名称 / 类型 / 地址 / 模型 / 密钥末四位 / 启停），与认证文件分页签切换
- **面板**：固定头、信息区、操作条，仅列表滚动；固定高度，切 Tab 不抖动
- **配额手动同步**：平时只读 CPA 本地数据，点「同步配额」才探测上游（每账号一次请求，缓存 120 秒）

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-cpa-status && dsh web   # 重启生效
```

## 配置

点侧栏「连接 CPA」填两项：

- **Base URL**：CPA 地址，如 `http://127.0.0.1:8317`；反代场景填到子路径根（`https://example.com/abc123`）
- **Management Key**：CPA 管理密钥，仅存本机凭据库，界面只显示末两位

Public URL 可选（「管理页 ↗」外链，默认 `{Base URL}/management.html`）。也可用环境变量预置：`CPA_BASE_URL` / `CPA_MANAGEMENT_KEY`（注入时表单内密钥只读）。

## FAQ

- **为什么没有 Token 总数 / 缓存率？** 唯一数据源是 CPA 的破坏性 usage 队列（读取会影响其他采集方），本插件承诺非侵入，故不设此槽位
- **为什么供应商没有请求数？** CPA 对 api-key 网关只暴露配置、无统计出口；请求类统计仅 OAuth 认证文件有
- **为什么配额要手动同步？** 探测上游 = 以账号身份发请求，主动权交给你；结果带同步时间，不拿旧数据冒充实时
- **健康刻度覆盖多久？** 约 3.3 小时（CPA 保留 20 个 10 分钟桶）
- **配额支持哪些 provider？** codex / kimi / xai 已实测，其余显示「暂无配额数据」；可在 `src/index.js` 的 `QUOTA_PROBES` 扩展
- **会和其他统计工具冲突吗？** 不会——不订阅不拉取 usage 队列，不写 CPA 任何数据

## 安全

管理密钥仅存本机凭据库；网关密钥出进程前脱敏为 `••••末四位`；配额经 `$TOKEN$` 占位符转发，插件与浏览器全程接触不到上游账号凭证；不做任何 CPA 写操作；本机 API 仅 loopback + `Cache-Control: no-store`。

## 开发

`src/index.js`（Host：本机 API / CPA 客户端 / 配额探针）· `src/client.js`（Client：侧栏入口与面板）· `cordis.patch.yml`（打包补丁）。改动后 `node --check` 校验，重启 `dsh web` 生效（纯 client 改动刷新页面即可）。
