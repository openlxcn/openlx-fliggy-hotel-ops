# 产品视觉与二维码

飞猪使用独立亮黄、奶油白、深灰色彩体系，少量紫色辅助。2026-09-06读取飞猪官网https://www.fliggy.com实际页面，主要按钮背景rgb(255,224,51)即#FFE033，顶部搜索背景rgb(102,102,255)即#6666FF；不将页面采样称为官方品牌规范。保留OpenLX系列共同版式。

- `public/assets/hotel-operations-fliggy-hero.png`：内置imagegen基于OpenLX系列自有概念图编辑的飞猪亮黄主视觉；图内品牌仅OpenLX，没有平台官方标识，不是实际物业照片。
- `public/assets/logo.svg`：OpenLX自有酒店轮廓标志，采用本产品亮黄配色。
- `public/assets/operation-flow.svg`：为飞猪重新编写的六步矢量流程图，含可访问的标题与描述。
- `public/assets/service-group-qr.png`：原样复用 `https://wx.openlx.cn/skills-assets/openlx-weixin-baimindan/wechat-whitelist-service-qr.png`。
- `public/assets/personal-qr.png`：原样复用 `https://wx.openlx.cn/skills-assets/openlx-weixin-baimindan/technical-director-wecom-qr.png`。

主视觉不含虚构业绩、客户评价或合作认证。二维码未经重绘；正式发布时比对公开源与本站文件SHA-256。

新主视觉：public/assets/hotel-operations-fliggy-hero.png，由内置imagegen基于OpenLX原图编辑。改为亮黄日历、深灰字与少量淡紫道具；保留酒店、湖景、箱包和OpenLX文字。生成提示词保存在docs/IMAGE-PROMPT.md。原始蓝色图保留在携程源项目，本产品不继续使用。
