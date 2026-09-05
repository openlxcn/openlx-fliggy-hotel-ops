# OpenLX 系列数据库同步合同 V1

日期2026-09-06。共享修改负责人：携程任务01a0729f-1b82-72a0-8ebf-6035548096b6。当前：本地32项检查通过，真实MySQL独立测试表8项检查通过；生产部署正在执行。接口可用状态以生产回执为准。

## 唯一身份与数据来源

用户仍来自 wx MySQL users.id，登录／注册／验证／密码变更都走 wx 原服务。不能按邮箱自行合并账户，也不能将用户类型当成付费等级。公众号原订单orders、权益agent_api_keys按本人用户ID实时读取，不复制API key。系列产品的订单、权益、酒店、设备元数据和工单状态，经事务性outbox投影进同一个MySQL的openlx_series_sources/openlx_series_records。

各业务表保留唯一修改方；页面统一读取中央概览，禁止两个方向互相覆盖同一条业务事实。酒店的本地ID属于产品命名空间，不自动等同跨产品property_id。通票和跨站免登录尚未实现，不自动授予其他产品付费权限。

## 会员读取

GET https://wx.openlx.cn/api/user/series，Authorization: Bearer <wx session token>（或wx域已有HttpOnly会话Cookie）。产品服务器转发用户自身token，浏览器不能传任意user_id读取他人记录。返回success/data，schema_version=1；包含user_id、products、records、wechat.orders、wechat.entitlements、sources、truncated、observed_at。records中只有本用户product_id/entity_type/data/synced_at；公号权益不含api_key，订单不含user_email。部分截断标记必须展示。

GET https://wx.openlx.cn/series 是中央会员页面；携程 /api/series 为自己会话保护的代理，登录后的会员中心自动读取。飞猪／美团可复用同一路由与自家Cookie前缀。

## 产品同步

POST /api/internal/series/sync，JSON：product_id,stream_id,from_revision,revision,records[]。服务端每产品独立密钥文件，不进浏览器、不进GitHub。头部：x-openlx-product、x-openlx-timestamp（13位毫秒）、x-openlx-signature（HMAC-SHA256 hex）。签名输入为 timestamp + 换行 + POST + 换行 + /api/internal/series/sync + 换行 + SHA256(JSON.stringify(body))。时差最长5分钟。

中央从认证密钥确定产品，body.product_id必须一致。stream_id为持久UUID；每产品只接受一个流，恢复旧库若流或修订冲突须先核对，不自动强行覆盖。每批最多300条；from_revision必须接上已确认修订。返回data.revision/duplicate/records；精确重试幂等。用户必须已在wx users存在；现有对象不可转移到另一个用户。

records项为entity_type/entity_id/user_id/deleted/data。entity_type只允许hotels、orders、entitlements、devices、tickets。data白名单与现有SQLite字段映射见 shared/wx-api/series.cjs 的FIELDS；snapshot保留已售套餐规则，工单只同步状态，不同步request/delivery文本；禁止Cookie、密码、设备token、许可证私钥和客人数据。deleted=true时data=null，保留墓碑防止旧数据复活。

## 本地生产者

可复用携程 src/series-sync.mjs 及 shared/wx-api/series.cjs；只复制代码，不复制密钥。createSync(db,{product:本产品ID,origin:'http://127.0.0.1:1978',keyFile:本产品服务器密钥路径})，start()启动15秒周期，flush()可即时执行，status()返回状态。对齐现有5张表字段，缺表不要直接启动。

SQLite触发器与业务变更同事务写series_outbox；启动自动回填现有记录。网络发送前把精确批次持久保存，连接在远端提交后中断也重放相同批次。中央确认后才推进ack并清除已发事件。失败保留SYNC_PENDING，不中断报告与其他业务。产品数据库从旧备份回滚后不能重置stream来掩盖冲突。

生产密钥由共享负责人生成到 /etc/openlx/series-ctrip.key、series-fliggy.key、series-meituan.key，chmod600；中央映射 /etc/openlx/series-product-keys.json。对应产品仅将自己的路径设为OPENLX_SERIES_KEY_FILE，不读取或记录其他产品密钥。

## 修改范围

wx新增 src/services/series.cjs、openlx/series.html、openlx/series.js；index.js仅挂载新路由；会员页添加系列概览入口。数据库只新增openlx_series_*两表，不覆盖wx原订单、用户、支付、SMTP或券逻辑。携程占1986、美团1988、飞猪1989，共享wx仍1978，不新增端口。

本次不开放通票销售、不改变现有付款回调；先让现有系列记录真实互通，再在统一身份上扩展明确的产品grant。后续通票中央签发服务另行交付，不能把当前投影视为签发服务。
