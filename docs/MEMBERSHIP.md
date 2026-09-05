# 共用账号与未来通票

账号身份复用 `wx.openlx.cn` 的 `user.id`，注册、邮箱验证、重置密码和SMTP走同一服务。各网站使用自己的 HttpOnly Cookie；当前是账号通用，并非跨域自动免登录。

当前飞猪订单、酒店授权、设备与权益使用独立账本。单品会员不自动获得别的技能。用户指定的未来季卡/年卡通票使用 `OPENLX_SKILL_PASS_V1`；代码在 `src/membership.mjs`，由唯一中央服务签发，产品只验签消费。

中央票据包含 `grant_id`、`subject_user_id`、`scope`（all/selected）、`resolved_product_ids`、`product_catalog_version`、`level_by_product`、`property_scope`、`property_bindings`、`cycle`、`starts_at`、`expires_at`、`order_id`、`issuer`、`status_verified_at` 和 `status_valid_until`。

“全部技能”也固化购买时覆盖的产品ID清单。新增产品不能静默进入已售通票；如销售合同提供新技能权益，中央服务按该合同签发新的范围快照。部分技能通票也使用显式清单。

本地酒店ID由用户填写，不能作为全局物业身份依据。中央票据的签名必须包含产品、账号、本地酒店到全局物业的绑定；同名酒店、不同账号和不同物业不能混用。全局物业绑定建立流程尚需中央会员服务实现。

`OPENLX_MEMBERSHIP_PUBLIC_KEY_FILE` 设置中央 Ed25519 公钥；未配置则无法导入通票。管理端运行 `node scripts/import-pass.mjs /private/grant.json` 导入中央签名快照。每次使用重新验签及校验范围、有效期、撤销状态的时效；有效缓存最多24小时。到期后回落到单品有效权益或免费版，不伪造延期。

通票本身不自动赠送每个技能的人工作业额度。人工作业需中央商品合同另外明确；目前通票人工工单只接受产品问题。

当前已实现：票据校验、范围隔离、已签名物业绑定、账本接收、许可证消费。尚未实现或上线：中央账号到全局物业的管理、通票商品与定价、统一支付签发、撤销推送、跨域免登录。官网不得称通票已开售。
