# Changelog

## 0.1.6

- 修复清除 Management Key 时意外清空 Public URL 与隐私设置的问题
- 网关地址响应只保留安全 origin，避免 URL 内嵌凭据泄露
- 配置请求增加 64 KiB 大小限制，保存后的 CPA 探测合并为单次请求
- 使用 Public Suffix List 判断可注册域，修复多租户私有后缀误判并完善环回地址识别
- 增加配置、探测、URL 脱敏和域名匹配回归测试

## 0.1.5

- 修复 CPA 管理接口 `api-call` 载荷兼容性：支持 `data` 与 `body` 双字段注入及自动提取 `file.project_id`，打通 Google 官方 `daily-cloudcode-pa` 分组配额池（返回真实扣减百分比）
- 优化前端提供商图标：新增 Antigravity 官方正版反重力矢量 Logo 与品牌科技蓝配色
- 增强配额池模型聚合与权重排序：对齐普号/会员分组池规范

## 0.1.4

- 优化 Antigravity 套餐名称简化：将 `Antigravity Starter Quota` 等超长全称精简为简洁的 `Starter` 徽章
- 增强配额探针容错与 Fallback：`retrieveUserQuotaSummary` 遇 403/404 时自动回退至 `fetchAvailableModels` 探测单模型配额，并在新账号未激活时提供明确提示

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
