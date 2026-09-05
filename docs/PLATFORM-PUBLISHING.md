# 多平台安装与发布

截至2026-09-06，飞猪产品使用同一份v0.1.0运行技能分发。免费报告长期可用，收费与跨产品通票尚未开放。真实商家账号读取、改价与点评发布仍需按账号核验。

## 平台状态

| 平台 | 当前状态 | 已核验的结果 |
|---|---|---|
| [GitHub](https://github.com/openlxcn/openlx-fliggy-hotel-ops/releases/tag/v0.1.0) | 已发布 | 官网与原始发行ZIP一致；运行包21个文件。 |
| [SkillHub](https://skillhub.cn/skills/user_ae43c502/openlx-fliggy-hotel-ops) | 已发布，可匿名下载 | 提交的22个文件全部一致；平台另加`_meta.json`。 |
| [魔搭ModelScope](https://modelscope.cn/skills/openlx/openlx-fliggy-hotel-ops) | 已公开，可匿名下载 | 21个运行文件全部一致，GitHub技能子目录自动同步已启用。 |
| [askill](https://askill.sh/skills/703902) | 已提交并索引 | 官方CLI的搜索及详情回读命中`openlxcn/openlx-fliggy-hotel-ops`。 |
| [skills.sh](https://www.skills.sh/) | GitHub安装已验证，目录尚未检索到 | 官方`skills` CLI安装后的21个运行文件一致；安装成功不等于榜单收录。 |
| [SkillsMP](https://skillsmp.com/about) | 等待GitHub抓取 | 已有公开仓库与有效`SKILL.md`，尚无收录回执。 |
| [ClawHub](https://clawhub.ai) | 预检通过，未正式提交 | 平台要求MIT-0；飞猪运行包许可仍待决定。 |
| [Cursor](https://cursor.com/marketplace/publish) | 飞猪插件资料已备齐，未提交 | OpenLX统一发布者申请正在审核；不能把该申请当作飞猪单品上架。 |
| Claude官方插件目录 | 插件包校验通过，未提交 | 统一发布任务报告尚无可用登录会话，该渠道此前已停止。 |
| [SkillsDirectory](https://www.skillsdirectory.com/skills/openlxcn-openlx-fliggy-hotel-ops) | 目录已公开，平台ZIP不完整 | 页面确认提交成功，源路径正确；平台ZIP只有20个文件，漏掉`scripts/scheduler.mjs`。请使用GitHub完整包或下方CLI安装。 |
| 扣子 | 未提交 | 创作者资格、实际使用案例与技能项目尚未核验。 |

SkillHub使用OpenLX统一发布账号和图标，提交包另含产品介绍、优势、主视觉与流程图。魔搭从GitHub的精确技能目录同步，源仓库当前未声明开源许可证，平台许可分类为`other`，未额外授予MIT或Apache许可。ClawHub许可决定与其他OpenLX产品分别记录。

## 安装

可下载[GitHub发行包](https://github.com/openlxcn/openlx-fliggy-hotel-ops/releases/tag/v0.1.0)，也可以从公开GitHub源安装：

```sh
npx skills add openlxcn/openlx-fliggy-hotel-ops --skill openlx-fliggy-hotel-ops --agent codex --copy
```

askill索引安装入口：

```sh
npx askill-cli add gh:openlxcn/openlx-fliggy-hotel-ops@openlx-fliggy-hotel-ops
```

安装后按[技能说明](../skills/openlx-fliggy-hotel-ops/SKILL.md)完成依赖检查、数据导入和报告生成。当前macOS/Linux已核验，Windows尚未实测。

SkillsDirectory已成功索引嵌套技能目录，其页面的`npx skills add`安装命令直接读取GitHub。该平台重新打包的ZIP缺少调度器文件，不能替代已验证的完整发行包；缺失原因尚未确认。

## Cursor与Claude插件包

仓库提供`.cursor-plugin/plugin.json`和`.claude-plugin/plugin.json`，复用`skills/openlx-fliggy-hotel-ops/`。分发ZIP仅含这两个描述文件、运行技能、OpenLX图标与介绍，不含官网服务端、支付后台、账号资料或私钥。插件资料齐备与官方商店审核是两项状态。

下载发行页中的`openlx-fliggy-hotel-ops-plugin-0.1.0.zip`并解压后，可以检查Claude插件结构：

```sh
claude plugin validate --strict /path/to/openlx-fliggy-hotel-ops-plugin
claude --plugin-dir /path/to/openlx-fliggy-hotel-ops-plugin
```

结构依据[Cursor插件规范](https://cursor.com/docs/reference/plugins)与[Claude插件规范](https://code.claude.com/docs/en/plugins-reference)。当前未写入未获确认的许可证字段。

## 核对依据

- 原始运行包：`c574508c897f3f734be4875cb04e4931aad62b622c772d8876de63eedf2425e9`。
- SkillHub公开包：`984afc0ab37df2608b6724f0584c892b276e8d86982e2d31f28c516b6c8a5bfe`，22个原文件一致，平台新增1个元数据文件。
- 魔搭公开包：`ecf45850459ac5082bdc85f77677cfe5e76658b030a58e6c86458a63abb879dc`，21个运行文件一致。
- SkillsDirectory公开包：`64f9598a2b2e420f1db9dc0a092018739a86bede62232c62cdf047ad76c8965a`，仅20个文件一致，缺少`scripts/scheduler.mjs`，包完整性为PARTIAL。
- 不同平台会重新压缩ZIP；核对解压后的文件字节，不要求平台ZIP哈希相等。

本页记录这一轮发布事实。平台后续审核与收录变化以对应平台回执为准。
