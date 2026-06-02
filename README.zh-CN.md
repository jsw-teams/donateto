# Donateto

支付网关 / Payment gateway with account login and USDT/TRC20 review for public support

语言： [English](README.md) | **简体中文**

`donateto` 是 JS.Gripe / 技诉加密货币支持网关的公开审计快照，包含轻量后端网关、`pay.js.gripe` 专用 Astro 前端，以及资金审核、地址管理和合规处理文档。

## 项目状态

| 项目 | 状态 |
| --- | --- |
| 仓库 | `jsw-teams/donateto` 公开审计快照 |
| 运行方式 | 无 Docker，Node 网关由 OpenResty 反代 |
| 前端 | Astro 支付页、状态页、管理员后台 |
| 首选资产 | USDT / TRC20 |
| 筛查 | 本地 OFAC/制裁地址精确匹配，必要时人工使用 Scorechain AI 复核 |
| 提现/归集 | 网关只记录提现请求，独立钱包服务执行转账并回调 |
| 测试 | 已完成 Nile 测试网真实链上入账 smoke；完整自动化测试仍缺失 |
| 许可证 | 尚未选择；加许可证前属于 source-available 公开审计，不是严格开源 |

## 目标流程

```text
myweb / myblog
  -> gateway.js.gripe/api/v1/donate
  -> 本机 donate-gateway
  -> 订单账本
  -> 链上轮询 / 未来可选支付服务 webhook
  -> 制裁与风险筛查
  -> 审核通过后表达感谢
  -> 发起提现请求给独立钱包服务
  -> 钱包服务执行归集并回调核验
```

## 目录结构

```text
.
├── gateway/                  # Node 后端网关源码
│   ├── src/                  # HTTP API、TRON 轮询、审核和提现请求逻辑
│   ├── config/               # 配置样例和本地 sanctions 名单模板
│   └── test/                 # smoke 脚本，不是完整测试套件
├── pay/                      # Astro 支付页、状态页、管理员后台
├── README.md                 # 英文说明
├── SECURITY.md               # 公开发布和运行安全说明
├── API.md                    # API 设计和当前接口
├── WALLET_ADDRESS_PLAN.zh-CN.md
├── COMPLIANCE_PLAYBOOK.md
└── RISK_CONTROLS.md
```

## 当前决定

- 第一版不使用 Docker。
- 不依赖 Binance Merchant 或 Binance Pay 商户 API。
- 不把长期固定的 Binance 充值地址作为主要公开支持入口。
- 使用短时有效订单、状态跟踪和先审核后感谢的流程。
- 支付网关第一版不直接签名转账；只记录提现请求，真实归集交给独立钱包服务。

## 为什么这样设计

当前主机已经有 Node.js、Go、Python、OpenResty，并且已经有
`gateway.js.gripe` 反代到本机服务的模式。Docker 尚未安装，因此轻量
Node 服务比直接部署 SHKeeper 或 Bitcart 更合适。

个人 Binance 账户可以接收资金，但不提供 Binance Pay Merchant 那种正式
订单 API 和 webhook。这里把 Binance 当作最终归集账户，而不是支付处理器。

## 开源项目评估

确实有开源项目可以覆盖“收款、唯一地址、webhook、钱包/归集”的一部分问题：

- Bitcart：MIT 开源，自托管支付处理器，支持 TRX/USDT 等多币种；适合想完整换成成熟支付处理器时评估。
- SHKeeper：开源 crypto processor，支持 Tron TRC20 的 USDT/USDC/TRX，也提供 API、插件和多币种钱包能力；但部署和运维体量比当前轻量 Node 网关更大。
- CryptoLink：MIT、自托管、非托管，文档写明支持 TRON/USDT、HMAC webhook 和收款地址/collector 模式；项目较新，适合观察其 TRON collector 思路，但不应直接替换生产系统。

本站当前不直接切换到这些项目，原因是：它们主要解决“收款处理”，不自动解决个人 Binance 归集合规、Scorechain/OFAC 审核留痕、account-system 管理员权限、以及 JS.Gripe 现有 OpenResty/Astro 接入。当前代码作为轻量、可审计的中间层保留；后续若要引入成熟项目，优先把它作为独立钱包/支付服务，而不是替换审核规则。

## 公开审计状态

为了透明，`/opt/donateto` 已整理为可公开快照，包含：

- `gateway/`：后端源码、配置样例、sanctions 名单模板和 smoke 脚本。
- `pay/`：`pay.js.gripe` Astro 前端源码。
- 文档：API、合规流程、地址管理、风险控制和实施计划。

不应公开的文件：真实 `config.json`、订单账本、钱包私钥/密钥文件、日志、`node_modules`、前端构建产物、真实 API secret。

当前 GitHub 目标为 `https://github.com/jsw-teams/donateto.git`。仓库公开后，外部审计者可以查看 `gateway/`、`pay/` 和文档，但真实运行配置、订单账本、钱包密钥和日志不得提交。

## 推荐第一条收款网络

第一版只开启一种稳定币网络：

- 如果优先考虑捐赠者便利：USDT / TRC20。
- 如果优先考虑 EVM 工具链和低摩擦归集：USDC 或 USDT / Polygon 或 Base。

不要第一天就开启很多链。每增加一条链，就会增加监控、确认、地址管理和风险审核成本。

## 必须遵守的控制点

- 每笔付款必须绑定订单 ID。
- 未匹配订单的直接转账不视为已接受支持。
- 可疑资金进入 `frozen_review`，不公开感谢。
- 不自动退回可疑资金。
- 审核流程稳定前不自动归集到 Binance。
- API key、钱包私钥和真实地址不能写入 git 跟踪文件。

## 文件

- `QUICKSTART.zh-CN.md`：快速接入和管理员登录步骤。

## 管理后台登录 URL

- 管理后台：`https://pay.js.gripe/admin/`
- 登录起点：`https://pay.js.gripe/auth/account/start`
- account-system Redirect URI：`https://pay.js.gripe/auth/account/callback`
- 当前账户系统登录 URL：`https://account.js.gripe/login`

未登录访问管理后台时，前端根据后台 API 返回的 `401 Unauthorized` 自动跳转登录，不依赖 URL 参数判断。

## 地址与过期订单

- 过期且未付款的 `created` 订单不会立刻删除；默认保留 1440 分钟观察期，继续扫描链上付款，避免晚到付款或索引延迟导致资金记录丢失。
- 观察期内仍无付款的过期 `created` 订单才会自动删除，释放对应收款地址。
- 已检测付款或进入审核的订单不会自动删除，必须保留审计记录。
- 已付款但金额不符的订单进入 `frozen_review`，资金标签为 `suspicious`，收款地址和来源地址必须保留，不能删除或复用，直到人工处理完成。
- `TEST_ONLY_` 地址和非 TRON 地址会被拒绝，不能用于真实收款。
- 创建订单时无法知道付款来源地址；来源地址需要在链上检测或 webhook 中以 `senderAddress` / `from` 写入。
- 当前允许本地服务器生成 TRON 收款地址：生成的私钥会 AES-256-GCM 加密保存到 `/opt/donate-gateway/data/wallets.json`，密钥文件为 `/opt/donate-gateway/config/wallet-secret.key`。这属于热钱包风险，应限制余额、权限和备份范围。
- 更稳妥的长期方案仍是离线预生成地址池或接入独立钱包服务。

## TRON 链上检测

已接入 TronGrid 的 USDT/TRC20 转账检测：

- 查询收款地址的已确认 TRC20 转账。
- 只匹配 USDT/TRC20 合约 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`。
- 金额完全匹配时，订单从 `created` 进入 `pending_review`。
- 金额在配置容差内时，订单从 `created` 进入 `pending_review`；默认容差为 `0.01 USDT`。
- 金额超出容差时，订单进入 `frozen_review`，资金标签为 `suspicious`。
- 自动写入 `txHash`、`senderAddress` 和基础 `screening` 记录。

注意：这只能判断链上付款事实和金额是否匹配，不能自动证明资金来源合法。最终 `legal` / `illegal` 仍需要管理员结合 AML/制裁/来源材料标记。

## AML 自动化筛查

可以接入自动化方案，但自动化结果应当写成“风险建议”，不要直接替代最终审核：

- 免费/低成本底线：对 `senderAddress`、收款地址和归集地址做 OFAC SDN / 制裁名单精确匹配；命中时自动进入 `frozen_review` 或 `rejected`，并保留筛查记录。
- 付费复核推荐：个人开发者第一家优先使用 Scorechain AI，而不是直接上 TRM / Chainalysis / Elliptic 这类企业销售型 KYT。Scorechain AI 明确面向个人、创业者和合规人员，公开价格、可用法币或 crypto 购买，适合本站这种低频小额支持场景。
- 商业 API 升级：如果未来订单量上来，再询价 Scorechain Wallet Screening API 或 AMLBot 官方 API。没有拿到低频可接受报价前，不建议把企业 KYT 写成默认依赖。
- 本地策略映射：`sanctions`、`stolen_funds`、`ransomware`、`darknet`、`mixer` 等高危命中自动标记 `suspicious` 并冻结；低风险只写入 `screening.riskTag=low`，仍由管理员点选 `legal` 后进入可提现金额。
- 审核留痕：每次自动筛查必须保存 provider、score、risk categories、checkedAt、raw reference，管理员改标签时保存备注和操作者。
- 误报处理：被自动标记可疑的支持仍要礼貌感谢对方意愿，但资金不进入可提现金额；支持者可以联系支持邮箱补充来源说明。

当前采用免费/低成本底线：

- 本地名单文件：`/opt/donate-gateway/config/sanctions-addresses.txt`
- 运行配置：`screening.provider = local-ofac-exact`
- 名单格式：每行一个地址，允许 `#` 注释；系统会做大小写无关的精确匹配。
- 检查对象：付款来源地址 `senderAddress`、订单收款地址 `payTo`、提现/归集目标地址 `destinationAddress`。
- 结果处理：命中时订单进入 `frozen_review` 且资金标签为 `suspicious`；提现目标地址命中时拒绝创建提现请求。
- 局限：未命中只代表本地名单没有精确匹配，不代表资金来源已被证明合法。

当前推荐的付费复核路线：

- 第一选择：Scorechain AI，手动复核 `senderAddress` 和必要时的收款地址。
- 使用时机：首次真实收款、金额接近上限、来源地址首次出现、提现到 Binance 前抽样、任何 `suspicious` / `unknown` 且需要人工判断的订单。
- 公开费用基线（2026-06-02 查验）：Growth 80 credits / 149 EUR，约 1.88 EUR 每次 Basic check；Pro 250 credits / 399 EUR，约 1.6 EUR 每次；Enterprise 1000 credits / 999 EUR，约 1 EUR 每次。credits never expire，且页面标注可获得 5 次免费检查。
- 选择原因：它公开写明无订阅、无需复杂部署，面向 crypto users / startups，并且背后是 2015 年成立的 Scorechain；比企业 KYT 的销售/合同流程更适合个人开发者。
- 接入边界：当前不把 Scorechain AI 自动化进后端，因为公开购买的是报告/检查额度，不等同于低价 API key。后端继续用 `local-ofac-exact` 自动拦截；Scorechain AI 结果由管理员写入审核备注和资金标签。
- 不建议第一版直接选：TRM、Chainalysis、Elliptic。它们可靠，但更偏企业合规团队，通常需要 demo / 合同 / 报价，不适合当前每笔 1-20 USDT 的个人支持入口。
- 备选 API：AMLBot 官方 API 可以后续询价，但只使用 `amlbot.com` 和 `docs.amlbot.com`，不要使用仿冒域名或要求连接钱包的第三方页面。

参考链接：

- Scorechain AI：`https://ai.scorechain.com/`
- Scorechain Wallet Screening API：`https://www.scorechain.com/`
- AMLBot 官方 API 文档：`https://docs.amlbot.com/webApi/introduction`
- OFAC 数字货币地址查询说明：`https://ofac.treasury.gov/faqs/594`

## Binance 归集

管理后台不提供“手动标记已归集”按钮。归集状态应由钱包服务或链上回调自动写入：

- 只有 `accepted + legal` 的订单进入可提现金额。
- 管理后台提供“发起提现请求”，管理员填写小于等于可提现金额的提现数额和本次 Binance USDT/TRC20 充值地址。
- 后端根据可提现金额自动分配到 `accepted + legal` 且未归集的订单；管理员不再通过勾选订单决定提现范围。
- 支付网关只记录提现请求，不直接把订单标记为已归集。
- 钱包服务执行提现/归集后，回调后端写入 `consolidated`。
- 后端会查询 TRON，确认归集交易真实转入 Binance 地址、来源是订单收款地址、金额不低于订单金额减去配置容差。
- 管理员只负责资金标签和审核备注，不负责手动标记归集成功。
- 真实自动转账需要独立钱包服务或冷/温钱包签名流程；支付网关不应直接持有热钱包私钥。

## 测试状态

目前还没有完整自动化测试覆盖，不能把当前实现视为已充分生产验证。已执行过的检查主要是：

- 后端 `node --check` 语法检查。
- 前端 Astro `npm run build` 构建检查。
- 少量手动/烟雾交互测试。
- Nile 测试网真实 TRC20 测试币入账 smoke。

### 已验证的 Nile 测试网结果

2026-06-02，已通过 Nile 测试网完成一次端到端 smoke：

- 网关创建订单：`dt_20260602_b9afc19479`。
- 订单金额：`1000.00` USDT 测试币。
- 订单收款地址：`TX8EoNhEYzoPn2WF2jjPDngfDnLNV7fcDU`。
- Nile TRC20 交易哈希：`a660f3f8f6b0737af509f06563e068534412e12561788282fa16b5b0fbaabfba`。
- 链上付款来源地址：`TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi`。
- 网关检测结果：`pending_review`，`amountMatched: true`，金额差额 `0.000000`，本地制裁地址精确匹配未命中。
- 测试实例 `donate-gateway-nile.service` 已关闭，`127.0.0.1:9011` 不再监听。

上线前仍需要补充：订单创建/过期观察期、TRON 金额匹配和金额不符、local OFAC 精确匹配、管理员权限、提现金额分配、webhook 归集核验、移动端 UI、无障碍访问的自动化测试。

- `TESTING.zh-CN.md`：Binance 资金来源下的真实测试策略，尽量减少 10U 提现测试次数。
- `WALLET_ADDRESS_PLAN.zh-CN.md`：USDT / TRC20 每单独立地址与资金安全方案。
- `IMPLEMENTATION_PLAN.md`：分阶段实施计划。
- `API.md`：API 设计草案。
- `RISK_CONTROLS.md`：风险控制流程。
- `COMPLIANCE_PLAYBOOK.md`：可疑资金处理方案。
- `CONFIG.example.json`：非密钥配置样例。
