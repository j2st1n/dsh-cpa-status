# Changelog

## 0.1.15

- 文档同步：README 补充 220ms 悬停微卡说明（显示门禁、纯读缓存、缓存为空时省略账号区、折叠态视口定位与限高）。
- `SECURITY.md` 新增两条：① 三条路由的来源围栏（`kind: 'exact'` 绕过宿主 `/api` 前缀准入，插件自补等价围栏；写路径另加 `application/json` 校验且在解析请求体之前拦截，被拒的写请求无法改写 `baseUrl` 或覆盖管理密钥；边界为不防同主机进程）；② 悬停预览纯读缓存、账号仅在打开面板时预取。

无代码改动。

## 0.1.14

- **修复折叠 rail 下悬停卡片被侧栏裁切**：侧栏折叠后布局列 `.sidebarCol` 带 `overflow: hidden`，卡片原先的 `left: 0; right: 0` 绝对定位会被挤成窄带再裁掉。现在折叠态先量触发器位置，改用 `position: fixed` 把 236px 宽卡片放到图标上方并夹在视口内；悬停中折叠/展开切换时按当前几何重新量测；量不到矩形时回落到兜底坐标而不是抛错。展开态维持原绝对定位，视觉不变。
- **悬停卡片加高度上限与内部滚动**：`maxHeight: min(360px, 50vh)` + `overflowY: auto`，账号多时卡片内部滚动，不再向上顶出视口。
- **悬停卡片改为纯读缓存**：不再在悬停 220ms 的回调里预取账号列表；账号尚未缓存（或确实为空）时整段省略，替换掉原先会一直显示的「正在读取账号池…」占位；账号只在打开面板的路径拉取。
- **卡片头部与流量统计的溢出处理**：标题与「N 次/30min · 成功率」各补 `title`，标题单行省略、统计值 `flexShrink: 0` 且不换行，窄卡片下不再互相挤压。
- 移除悬停卡片标题与网关行里的装饰性 emoji（`🏢`、`🌐`），改用纯文本标签。

## 0.1.13

- **补上三条接口的来源围栏与写请求内容类型校验（安全修复）**：`/api/cpa-status`、`/api/cpa-status/config`（GET/PUT）、`/api/cpa-status/accounts` 原先以 `kind: 'exact'` 直接注册在 webServer 上，绕过了 DSH 对 `/api` 前缀通道的准入校验。实测确认的攻击链是：伪造 Host + 跨站 Origin + `Sec-Fetch-Site: cross-site` + `text/plain` 的 PUT 会返回 `200 saved:true`，把 `baseUrl` 改成攻击者地址、并覆盖 `managementKey`——在不启用插件时该风险为零（路由未注册），一旦启用即可被同机进程与 DNS rebinding 页面读写。现在三条路由统一接入宿主等价的围栏：Host 必须是环回、监听器 bind 地址或 `connection.trustedHosts` 之一，拒绝 `Sec-Fetch-Site: cross-site`，带 Origin 时必须同 authority；宿主提供 `connection.isTrusted` 时以其判定为准，缺失时回退本地等价实现。`config` 的 PUT 另加 `application/json` 校验（不匹配返回 415）。不可信来源一律返回 403，且拒绝发生在读取请求体之前，配置与密钥不会被改写。
- 围栏为自包含实现，未引入新依赖；既有的网关同源判定 `isLoopbackHostname` 保持原样未改动（新增的围栏版本命名为 `isLoopbackFenceHostname` 以避免语义冲突）。

## 0.1.9

- 增加侧边栏鼠标悬停（Hover 220ms）账号池概览卡片：无需点击即可快速查看 5 账号在线存活、脱敏邮箱、套餐徽章（Pro/Team/Free）与近 30 分钟请求流量刻度；点击则保留进入深度操作台（同步配额、配额进度条与连接设置）。

## 0.1.8

- 优化 Antigravity 账号套餐徽章展示体验：引入 `planCache` 与自动轻量探测机制，打开面板时自动解析 Antigravity 订阅等级（如 `Pro` / `Starter` / `Free`），与 ChatGPT 体验一致，无需手动点击「同步配额」即可一直显示。

## 0.1.7

- 优化 README 安装命令为官方 npm 源优先。

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
