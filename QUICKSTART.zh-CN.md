# 快速接入

## 1. 当前可用入口

公开支持页：

```text
https://pay.js.gripe/
```

主站联系页也会提供入口：

```text
https://js.gripe/contact/
```

API：

```text
POST https://gateway.js.gripe/api/v1/donate
GET  https://gateway.js.gripe/api/v1/donate/:orderId
```

## 2. 创建订单

请求：

```bash
curl -X POST https://gateway.js.gripe/api/v1/donate \
  -H 'Content-Type: application/json' \
  -d '{
    "amount": "5.00",
    "asset": "USDT",
    "network": "TRC20",
    "displayName": "friend",
    "sourceNoticeAccepted": true
  }'
```

金额支持 `1.00` 到 `20.00` USDT，最多两位小数。前端提供 3/5/10/20
USDT 和自定义金额。

## 3. 管理员查看订单

管理员页面：

```text
https://pay.js.gripe/admin/
```

未登录访问时，管理页会根据后台 API 的 `401 Unauthorized` 状态自动跳到账户系统登录，不依赖 URL 参数判断。

登录起点：

```text
https://pay.js.gripe/auth/account/start
```

account-system 需要回跳的 Redirect URI：

```text
https://pay.js.gripe/auth/account/callback
```

当前配置中的账户系统登录 URL：

```text
https://account.js.gripe/login
```

登录方式：

1. 在 `account.js.gripe` 的 dashboard 创建 API client。
2. Redirect URI 填：

```text
https://pay.js.gripe/auth/account/callback
```

3. Scopes 至少包含：

```text
accounts:read
```

4. 将 client id 写入：

```text
/opt/donate-gateway/config/config.json
```

字段：

```json
{
  "account": {
    "clientId": "cli_xxx"
  }
}
```

5. 重启：

```bash
systemctl restart donate-gateway.service
```

只有 account-system 里的 `system_admin` 可以查看订单和标记状态。

## 4. 订单标记

管理员可标记：

- `accepted`：资金可接受，仍表示感谢。
- `frozen_review`：资金来源需要调查，礼貌感谢对方有心支持，并说明可联系支持团队。
- `rejected`：不能接受这笔付款，但仍感谢支持意图。
- `consolidated`：已归集到 Binance。

## 5. 真实收款前必须替换测试地址

当前配置里的地址如果仍是：

```text
TEST_ONLY_REPLACE_WITH_REAL_RECEIVE_ADDRESS
```

则只能用于流程测试，不能用于真实收款。

真实上线前需要配置每单独立收款地址方案，见：

```text
WALLET_ADDRESS_PLAN.zh-CN.md
```
