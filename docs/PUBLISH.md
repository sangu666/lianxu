# 发布到GitHub

只发布项目目录。公开前运行 `npm ci`、`npm run check`、`npm run format:check`，检查 `git status` 与待提交文件。仓库不应包含真实照片、训练记录、数据库、环境文件或令牌。

建议仓库名：lianxu；可见性：Public；代码许可证：MIT。创建远程仓库时不要另外初始化README，以便直接推送本地源码。

若尚未设置Git身份，请在本仓库配置自己的姓名和GitHub隐私邮箱，然后提交。发布命令中的OWNER必须替换为自己的GitHub用户名。

```sh
git add .
git commit -m "Initial open-source prototype"
git remote add origin https://github.com/OWNER/lianxu.git
git push -u origin main
```

使用GitHub连接或命令行登录，不在聊天、源码或仓库中粘贴访问令牌。远程仓库名已存在时先核实，不覆盖或强制推送已有仓库。

当前GitHub Actions只检查代码，不会自动部署。未来可以单独配置GitHub Pages，将dist作为站点产物；发布源码并不等于发布已验证的AI产品。
