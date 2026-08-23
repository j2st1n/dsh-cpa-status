# dsh-cpa-status

[CLIProxyAPI（CPA）](https://github.com/router-for-me/CLIProxyAPI) 的 DeepSeek Harness (DSH) 状态面板插件：侧栏常驻状态灯，点开即看账号池配额、健康与流量——不用每次开 CPA 管理页。

<p align="center">
  <img src="https://raw.githubusercontent.com/xohmai/dsh-cpa-status/main/docs/images/panel.png" alt="状态面板" width="820">
</p>

## 功能特性

- **极简常驻态**：单行自适应状态胶囊（`● CPA · 3/3 账号 · 28 次/30min`），健康时低调克制，成功率异常或账号缺员时自动变色告警，默认不打扰。
- **账号池卡片**：
  - **套餐徽章**：支持识别 `Pro`、`Plus`、`Free` 等套餐等级及订阅剩余天数；
  - **多模型分组配额池**：已适配 **Antigravity（Gemini / Claude 组 5h 与周限额）**、**Codex**、**Kimi**、**xAI** 等上游配额探针；
  - **监控指标宫格**：实时展示请求总数、成功率、近 30 分钟流量；
  - **健康刻度带**：约 3.3 小时（逐 10 分钟桶）成败刻度，直观排查限流与故障。
- **AI 供应商页**：支持查看 api-key 供应商网关列表（类型 / 地址 / 模型 / 密钥末四位 / 启停状态），与 OAuth 认证文件分页签快速切换。
- **平滑交互体验**：浮层面板智能定位，点击外部任意空白区域自动收起，用完即走。
- **手动配额同步**：平时仅读取 CPA 本地数据，点击「同步配额」才触发上游探针，对上游与网关完全非侵入。
- **企业级安全**：管理密钥仅存本机凭据库；网关密钥只显示末四位；支持一键开启「脱敏模式」打码邮箱与地址。

<p align="center">
  <img src="https://raw.githubusercontent.com/xohmai/dsh-cpa-status/main/docs/images/collapsed.png" alt="侧栏底部收起态">
</p>

## 配额与探针支持

| 供应商 / 账号类型 | 流量与健康刻度 | 额度进度条 | 支持的配额维度 | 套餐徽章 |
| :--- | :---: | :---: | :--- | :---: |
| **Antigravity** (Google) | ✅ | ✅ | **Gemini 组** (5h / Weekly)<br>**Claude/GPT 组** (5h / Weekly) | ✅ (Pro / Free) |
| **Codex** (ChatGPT) | ✅ | ✅ | 5h 滑动窗口、Weekly、模型配额 | ✅ (Free / Plus / Team) |
| **Kimi** (Moonshot) | ✅ | ✅ | Weekly、周期用量 | ✅ (Tier / Level) |
| **xAI** (Grok) | ✅ | ✅ | Period、按量付费 (On-demand) | ➖ |

## 安装与更新

### 1. 一键安装（自动拉取最新最新版）

```sh
dsh plugin --profile web add github:j2st1n/dsh-cpa-status
```

> **说明**：
> - 无需指定版本号，默认直接拉取 GitHub 上的**最新版本**（相当于 `@latest`）；
> - 若需锁定特定稳定版本，可指定 Tag：`dsh plugin --profile web add github:j2st1n/dsh-cpa-status#v0.1.1`；
> - 本插件为**纯原生 JS 零构建（Zero-build）**架构，无打包与编译步骤，安装后重启 `dsh web` 即可立即生效。

### 2. 卸载

```sh
dsh plugin --profile web remove dsh-cpa-status
```

## 配置

点侧栏「连接 CPA」，填两项：

- **Base URL**：CPA 地址，如 `http://127.0.0.1:8317`；反代场景填到子路径根（`https://example.com/abc123`）
- **Management Key**：CPA 管理密钥，仅存本机凭据库

**可选配置**：
- **Public URL**：「管理页 ↗」外链，默认 `{Base URL}/management.html`（适用于内网反代至公网域名的跳转场景）。
- **环境变量预置**：支持通过环境变量 `CPA_BASE_URL` / `CPA_MANAGEMENT_KEY` 预先注入（env 注入时 Web 表单密钥为只读保护）。

## 安全声明

- Management Key 只写入宿主凭据库，接口响应绝不回传完整明文密钥；
- 账号/网关字段白名单过滤返回；网关密钥仅展示末四位；
- 支持开启脱敏模式（Privacy Mode），自动对邮箱、地址与账号名称进行打码掩码；
- 详细安全机制参见 [SECURITY.md](./SECURITY.md)。

## 致谢

本项目基于 [xohmai/dsh-cpa-status](https://github.com/xohmai/dsh-cpa-status) 进行功能扩展与布局优化，遵循 Apache-2.0 协议开源。

## License

[Apache-2.0](./LICENSE)
