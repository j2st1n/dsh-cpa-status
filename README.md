# dsh-cpa-status

[![npm](https://img.shields.io/npm/v/dsh-cpa-status?color=blue)](https://www.npmjs.com/package/dsh-cpa-status)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

[CLIProxyAPI (CPA)](https://github.com/router-for-me/CLIProxyAPI) 的 DeepSeek Harness 状态面板插件：侧栏常驻状态灯，点开即看账号池配额、健康度与流量统计。

## 核心特性

- **极简常驻态**：单行自适应状态胶囊（如 `● CPA · 3/3 账号`），健康时低调克制，异常时变色预警。
- **账号池看板**：展示 Pro/Plus 套餐等级、Gemini/Claude/Codex/Kimi/xAI 配额进度条及 3.3 小时健康刻度带。
- **网关与凭据管理**：查看 AI 供应商网关列表，密钥仅存宿主凭据库，支持脱敏模式打码。
- **轻量零构建**：纯原生 JS 零构建架构，面板智能定位与外部点击收起，即装即用。

## 安装与使用

### 一键安装

```bash
dsh plugin --profile web add dsh-cpa-status
```

> 或通过 GitHub 仓库安装：`dsh plugin --profile web add github:j2st1n/dsh-cpa-status`

### 快速配置

1. 安装完成后启动或重启 `dsh web`。
2. 点击侧栏「连接 CPA」配置 Base URL（如 `http://127.0.0.1:8317`）与 Management Key（仅存本地凭据库）。亦可通过环境变量 `CPA_BASE_URL` / `CPA_MANAGEMENT_KEY` 预置。

### 卸载

```bash
dsh plugin --profile web remove dsh-cpa-status
```

## License

[Apache-2.0](./LICENSE)
