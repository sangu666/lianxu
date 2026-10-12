import { readFile } from 'node:fs/promises';

// 仅在GitHub Actions中运行。令牌由平台临时提供，不写入文件、不打印到日志。
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('发布脚本仅供GitHub Actions使用');
const repository = process.env.GITHUB_REPOSITORY;
const commitSha = process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;
if (
  !repository ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
  !/^[a-f0-9]{40}$/.test(commitSha ?? '') ||
  !token
)
  throw new Error('发布环境无效');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本号格式无效');
const tag = `v${version}`;
const endpoint = `https://api.github.com/repos/${repository}/releases`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Lianxu-release',
};
// 同一软件版本只发布一次，后续文档修改不移动已存在的版本标签。
const existing = await fetch(`${endpoint}/tags/${tag}`, { headers });
if (existing.ok) console.log(`${tag}已存在，跳过发布。`);
else {
  if (existing.status !== 404) throw new Error(`检查版本失败：HTTP ${existing.status}`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: commitSha,
      name: `练序 ${tag}`,
      body: '训练开始与完成、组记录编辑、历史与上次成绩、JSON备份与恢复。\n\n完整变化和限制请阅读此版本的CHANGELOG.md、README.md与docs/V0.2-REVIEW.md。\n\n当前仍是本地原型，未接入真实AI或云端账号。',
      draft: false,
      prerelease: false,
    }),
  });
  if (!response.ok) throw new Error(`发布失败：HTTP ${response.status}`);
  console.log(`${tag}已发布：${(await response.json()).html_url}`);
}
