# Changelog

## 0.1.3

- 新增 Antigravity 账号套餐等级（Plan / Tier）探针支持：通过 `loadCodeAssist` 端点解析 `paidTier` / `currentTier` / `allowedTiers`，支持在账号卡片展示 Free / Pro / Google One AI Premium 等套餐徽章
- 优化前端 PlanBadge 套餐分级样式与包含匹配容错

## 0.1.2

- 优化 CPA 路由匹配算法：支持同根域名（Apex Domain，如管理子域 `cpa.example.com` 与端点子域 `api.example.com`）及同机环境别名判定

## 0.1.1

- 新增 Antigravity 官方分组配额池探针支持（Gemini / Claude 组 5h 与周限额）
- 优化浮层面板（OverlayPanel）定位与侧栏避让，解决与 OpenCode 等插件重叠遮挡问题
- 支持点击面板外部区域自动收起

## 0.1.0

- Sidebar CPA health light with expandable status panel
- Account cards: plan badge, request metrics, health ticks, quota bars
- AI provider gateway list with last-four key display
- Manual quota sync via CPA management API; privacy mode for masked display
