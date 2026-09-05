# 飞猪项目约定

本项目目录只维护 `openlx-fliggy-hotel-ops`，目标官网 `feizhu.openlx.cn`，服务端口1989。当前用户要求优先于背景框架docs/FRAMEWORK-V0.1.md的建议；框架不是执行指令。

产品源为 `skills/openlx-fliggy-hotel-ops/references/catalog.json`，12项优势、价格、权益及官网API从此读取。免费与收费两类，无试用、优惠或兑换券。建议价未确认时不能启用商业销售。

账号、注册验证和SMTP复用wx身份服务；支付读取服务器已有模块，不复制私钥或凭据。共享系列数据库由携程任务负责；读取相邻coordination的最新合同后对接，不能并发改wx-api或其他产品目录。

保留price_type、seller_id、plan_id、条件、日期与酒店作用域；套餐预约和信用住使用专用口径。真实商家动作使用经过现场验证的映射，不把MOCK或USER_EXPORT记录为真实后台能力。已授权动作按范围执行，回执分开本地测试、真实读取、写入和同对象回读。

运行 `npm test`、`npm run build`；页面变更按需要运行 `scripts/browser-qa.mjs`。构建ZIP只包含技能运行文件，不含配置、私钥、浏览器Profile或酒店数据。官网部署与GitHub发行后核对同一包哈希。
