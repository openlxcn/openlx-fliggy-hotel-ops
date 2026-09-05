# 官网部署

域名：`https://feizhu.openlx.cn`。独立服务：`openlx-fliggy-hotel-ops.service`，目录`/www/wwwroot/openlx-fliggy-hotel-ops`，监听`127.0.0.1:1989`。携程1986、美团1988，不占用其他项目端口。

账号复用同机wx服务 `http://127.0.0.1:1978`；支付通过`OPENLX_SHARED_ROOT=/www/wwwroot/wx-api`读取既有模块。不会复制SMTP或支付凭据至本仓库。`.env.production`、数据库、签名私钥和平台会话只存在私密运行目录。

Nginx独立配置为`/www/server/panel/vhost/nginx/feizhu.openlx.cn.conf`，ACME证书位于同域名cert目录。更新前备份本站应用、配置及SQLite账本，保留许可证密钥。用npm ci安装运行依赖、systemd启动，Nginx配置测试通过后reload。回退仅恢复本站版本与路由，不替换其他站点。

公开安装包必须包含与本服务一致的许可证公钥；只复制public key，不导出私钥。用户数据不进入发布包。

`SALES_ENABLED=false`；价格目录还需`pricing_status=CONFIRMED`才能允许订单创建。当前商业收款未开放，不把支付方式配置成功当作真实交易已验收。

上线后分别核对服务active、回环health、HTTPS health、首页、会员中心、报告、静态图片、二维码SHA-256、发行ZIP及校验文件。共享wx健康也须复查。真实登录、邮件送达与支付结果按实际业务回读单列。
