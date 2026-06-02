# 测试策略

目标：在资金只能先从 Binance 提出的前提下，尽量少花真实 USDT，同时验证支付网关最关键的链上路径。

## 先区分两个 Binance 限制

- **Binance 提现最低额**：从 Binance 向外部钱包转出 USDT 时适用。如果用 Binance 作为测试资金来源，可能需要满足 10U 级别的最低提现额和固定手续费。
- **Binance 充值最低额**：从外部钱包转入 Binance 充值地址时适用。USDT/TRC20 通常远低于 10U，具体以 Binance 充值页面当前显示为准。

如果测试资金目前只在 Binance 账户内，那么“真实主网入账测试”确实需要先从 Binance 提出，最低提现额和固定手续费绕不开。结论是：不要用 Binance 提现反复测所有场景；只做一次最小提现额的真实验收，其余用测试网、模拟事件和链上回放覆盖。

## 推荐测试分层

### 1. 免费：TRON Nile / Shasta 测试网

用途：

- 验证 TRON API、TRC20 转账解析、地址格式、金额匹配逻辑。
- 验证前端订单创建、状态查询、管理员审核、弹窗和移动端 UI。

做法：

- 使用 TRON 官方测试网 faucet 获取测试 TRX / TRC20 token。
- 将 gateway 配置切到 testnet API，例如 Nile 或 Shasta 的 TronGrid endpoint。
- 使用测试 token 做金额匹配、金额不足、金额超额、重复付款场景。

局限：

- 测试网 token 不是真实 USDT。
- 测试网无法证明 Binance 充值路径可用。
- 测试网合约地址和主网合约地址可能不同，配置必须明确区分。

本站当前已经准备好测试网配置：

- Nile 运行配置：`/opt/donate-gateway/config/config.testnet-nile.json`
- Shasta 运行配置：`/opt/donate-gateway/config/config.testnet-shasta.json`
- 公开样例：`gateway/config/config.testnet-nile.example.json` 和 `gateway/config/config.testnet-shasta.example.json`
- 测试网账本与钱包文件使用 `testnet-*` 独立路径，不会污染主网 `orders.json` / `wallets.json`。
- 测试网端口：Nile 使用 `127.0.0.1:9011`，Shasta 使用 `127.0.0.1:9012`。

启动 Nile 测试网实例：

```bash
DONATE_GATEWAY_CONFIG=/opt/donate-gateway/config/config.testnet-nile.json node /opt/donate-gateway/src/server.mjs
```

在另一个终端创建测试订单：

```bash
node /opt/donate-gateway/test/testnet-order-smoke.mjs
```

脚本会输出：

- `orderId`
- 测试网 `payTo` 收款地址
- 订单金额，默认 `5.00`

然后在 TronLink 切换到 Nile 或 Shasta 测试网，把 faucet 获取的测试 USDT 发送到 `payTo`。

测试网 faucet：

- Nile: `https://nileex.io/join/getJoinPage`
- Shasta: `https://shasta.tronex.io/join/getJoinPage`
- 官方社区 Bot 也支持 `!nile_usdt ADDR` / `!shasta_usdt ADDR` 领取测试 USDT。

配置注意：

- 主网配置继续使用 USDT/TRC20 合约地址 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` 精确匹配。
- 测试网样例不写主网合约地址，而使用 `tokenSymbol: "USDT"` 匹配 faucet 发出的测试网 TRC20 USDT。
- 不要把测试网配置部署到公网 `pay.js.gripe` 或 `gateway.js.gripe`，也不要把测试网订单标记为真实支持。

### 2. Binance 资金来源：一次 10U 真实收款验收

用途：

- 验证真实 TRON 主网 USDT/TRC20 入账检测。
- 验证 `senderAddress`、`txHash`、local OFAC 精确匹配、金额容差和 `frozen_review`。
- 验证 Binance 提现到订单收款地址后，网关能识别真实链上交易。

做法：

- 先确认 Binance 当前 USDT/TRC20 提现页面展示的最低提现额、手续费和“实际到账 / Receive amount”。
- 创建订单时，订单金额应填写 Binance 页面显示的**实际到账金额**，不是只看输入的提现金额。
- 将 Binance USDT/TRC20 提现目标地址填写为订单的 `payTo` 地址。
- 等待 TRON 确认和 TronGrid 索引，检查订单是否从 `created` 进入 `pending_review`。
- 管理员再做 local OFAC / Scorechain AI 复核和资金标签标记。
- 金额不符场景不建议再花一次 Binance 提现测试；应先用测试网、模拟 webhook 或链上回放测试。

成本：

- 成本至少包含一次 Binance 最低提现额和固定提现手续费。
- 如果 Binance 显示提现 10 USDT、实际到账扣除手续费后的金额小于 10 USDT，就必须按实际到账金额创建订单，否则系统会进入 `frozen_review`，这是正确行为。
- 如果订单收款地址是服务器本地生成的地址，后续归还/归集需要该地址有 TRX gas / energy，并且需要能安全使用对应私钥。

### 3. 更安全的主网验收配置：先用可控钱包地址池

由于当前独立钱包服务尚未完成，第一次 Binance 真实提现不建议直接打到服务器自动生成的热钱包地址，除非已经确认：

- `/opt/donate-gateway/data/wallets.json` 中对应私钥可以被安全恢复和使用。
- 该收款地址有足够 TRX 支付后续 USDT/TRC20 转账 gas，或有独立钱包服务能注入 gas。
- 归集/退回路径已经演练过。

更稳妥的测试方式：

- 在 TronLink / Trust Wallet 创建一个你自己控制的钱包地址。
- 把这个地址临时写入运行配置的 `addressPool`，并暂时关闭 `wallet.localAddressGeneration`。
- 创建订单，让网关把这个可控地址作为 `payTo`。
- 从 Binance 提出最小金额到该订单地址。
- 完成检测和审核后，你可以用 TronLink 控制该地址，把测试资金转回 Binance 或留作后续测试。

注意：这个可控钱包地址只能用于测试，不应长期作为公开固定收款地址。

### 4. 真实归集验收：少次数转入 Binance

用途：

- 验证管理员填写 Binance USDT/TRC20 充值地址。
- 验证提现请求按可提现金额分配。
- 验证钱包服务完成转账后，后端通过 TRON 交易核验并写入 `consolidated`。

做法：

- 等这次 Binance 提现测试资金通过审核后，再用同一笔资金做一次归集回 Binance 的验收。
- 如果使用可控 TronLink 地址池测试，可以手动从 TronLink 转入 Binance USDT/TRC20 充值地址，并把 tx hash 提交给回调/管理流程核验。
- 如果使用服务器生成地址测试，必须等独立钱包服务或手动安全签名流程准备好后再归集。
- 归集前再次确认 Binance 充值地址、网络为 USDT/TRC20，且地址没有过期或变更。

注意：

- 真实归集验收不需要每个订单都单独打到 Binance。
- 不要把可疑、金额不符、`unknown`、`suspicious`、`illegal` 资金混入归集测试。
- 如果金额不符但已经付款，必须保留订单、收款地址、来源地址和 tx hash，不能自动删除或复用。

## 建议的最小验收矩阵

| 场景 | 网络 | 真实资金 | 目标 |
| --- | --- | --- | --- |
| 创建订单但不付款 | 本地/主网均可 | 否 | 过期观察期内不释放地址 |
| 金额正确付款 | TRON 主网 | 1 USDT | `created -> pending_review` |
| 金额不符付款 | TRON 主网 | 0.5-1.5 USDT | `created -> frozen_review`，保留地址 |
| 本地 sanctions 命中 | 本地名单 | 否/可模拟 | 自动 `suspicious` |
| 管理员标记合法 | 后台 | 否 | 进入可提现金额 |
| 提现请求 | 后台 | 否 | 金额小于等于可提现金额，后端自动分配 |
| Binance 提现验收 | TRON 主网 | Binance 最低提现额 | 用实际到账金额创建订单并检测付款 |
| 归集回调核验 | TRON 主网 | 同一笔测试资金 | 后端验证来源、目标和金额 |

## 当前缺口

- 尚未实现完整自动化测试套件。
- 尚未实现独立钱包服务的自动签名与转账。
- testnet 配置需要单独维护，不能和主网配置混用。
- 真实测试前必须再次核对 Binance 页面展示的当前充值/提现限制和费用。
- 如果只能从 Binance 提出资金，真实主网测试无法降到 1U；最低成本是减少次数，而不是降低单次提现额。

## 参考

- TRON 官方测试网 token 获取说明：`https://developers.tron.network/docs/getting-testnet-tokens-on-tron`
- Binance 存取款费用页面：`https://www.binance.com/en/fee/cryptoFee`
- TronGrid Shasta：`https://www.trongrid.io/shasta/`
