import { mkdir, cp } from 'node:fs/promises';
const source = new URL('../public/', import.meta.url);
const target = new URL('../dist/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log('静态站点已生成至 dist/；没有打包个人记录或照片。');
