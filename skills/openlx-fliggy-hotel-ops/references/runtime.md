# 使用与字段

安装：在解压后的技能目录执行 `node scripts/install.mjs install`，默认安装到 `~/.codex/skills/openlx-fliggy-hotel-ops`。支持 `--target`、`upgrade`、`rollback`、`uninstall`；卸载与升级保留外置酒店工作区，旧技能移到备份目录。Node.js至少22.20。

基本流程见SKILL.md。数据样例为演示用途，真实导出必须使用目标酒店自己的字段。

## 经营快照

`hotel`: `id/name/address`；`identity`: `hotel_id/account_id/merchant_id/seller_id`；`source`: `type/account_id/reference`；`observed_at`为ISO时间。缺失数组用null，确实读取到空集合用[]。

`rates[]`必须包含 `seller_id/room_id/plan_id/date/price_type/price_fen/currency`，价格类型为SUPPLY或RETAIL。`editable`记录本人权限；`writer=FLIGGY`与快照`price_authority=FLIGGY`才允许本工具写入；`conditions_hash`关联核验后的早餐、退改、会员与连住条件。不会把同名房型自动合并。

`packages[]`：sold_units、nights_per_unit、refunded_rights_nights、confirmed_room_nights、fulfilled_room_nights。已预约字段包含已履约数量；部分退款按权益房晚更新，不把退款金额直接换算房晚。`capacity_verified`、valid_until、excluded_dates、surcharge_terms按实际商品填写。

`orders[]`：status、payment_mode、effective_room_nights、fulfilled_room_nights；信用住额外`credit_validated`。有效订单状态支持BOOKED、CHECKED_IN、CHECKED_OUT、PARTIAL_REFUND；CANCELLED、REFUNDED剔除，未映射状态单列未知。PREPAID、PAY_AT_HOTEL、CREDIT_STAY与日历房/套餐产品类型分开。

`settlements[]`优先 net_settlement_fen、variable_cost_fen（仅指净结算未含的成本）。无实际净结算时填写 merchant_revenue_fen、merchant_discount_fen、commission_fen、platform_fee_fen、variable_cost_fen 和 rules_verified。候选调价收益另提供 candidate_settlement，绑定 for_price_fen、price_type，不能沿用旧结算。

`rank_observations[]`记录 query、location、checkin、checkout、adults、sort、filters、account_state、observed_at、depth、channel(NATURAL/AD)、position/status。未观察到记NOT_SEEN_WITHIN_DEPTH。

## 账号映射

工作区 `adapter-ebooking.json` 由真实页面核验得到。当前发行包不提供未经实测的选择器。必需字段：account_id/account_label、hotel_id/hotel_label/hotel_address、seller_id/seller_label、verified_at、evidence_reference、identity的account/hotel/seller选择器、price_authority/inventory_authority。

`reads`按数据域配置url、rows、fields、可选constants。每个field为selector/type、可选attribute，或明确固定value。type为text/integer/fen/boolean。分页能力尚未适配；超过500行或存在分页时仅记PARTIAL并记录覆盖范围，不能将第一页称全店完整。

`writes[kind][object_id]`包含url、current/current_is_input、input、submit、readback/readback_is_input、readback_url、identity/identity_value、value_type。PRICE额外匹配update_semantics=INCREMENTAL、seller_id、plan_id、date、price_type、conditions_hash；REVIEW要求review_text/review_rating选择器用于执行前复查内容。

运行 `browser.mjs read`采集，`ops.mjs reviews/prices/propose`提案，`approve --id ... --hash ...`记录已明确的用户批准。执行和回读使用`ops.mjs execute/readback`。商家页面流程有多层弹窗、多字段组合或不可逆状态时，应增加精确适配后再执行，本版单字段执行器不能冒充全流程支持。

## 价格授权

参考 `example-pricing-policy.json`。策略必须列出account_id、seller_id、hotel_id、room_ids、plan_ids、dates、price_type、conditions_hashes、update_semantics、floor_fen、ceiling_fen、target_fen、max_change_bps、daily_change_bps、daily_count、cooldown_minutes、max_age_minutes、valid_until。通过`hash`函数计算最终JSON摘要；用户授权该具体策略后登记。确认模式可用于免费人工决策；AUTOMATIC要求服务端有效许可证。

## 会员与设备

在官网用现有OpenLX账号登录，登记酒店和设备。`node scripts/ops.mjs device`取得本机ID。`license --file ...`导入官网签名许可证；运行器在线刷新，最长24小时离线有效。过期或停用时保留免费报告与数据。

当前通票合同由中央签名，单产品不自建发券或销售入口。详情见仓库docs/MEMBERSHIP.md；网站当前标注尚未开售。
