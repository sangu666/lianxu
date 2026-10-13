import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname } from 'node:path';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      const local = relative(root, file);
      if (
        local.startsWith('..') ||
        path.split('/').some((part) => part.startsWith('.')) ||
        !types[extname(file)]
      ) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.on('error', (error) => {
    console.error(`启动失败：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`练序已启动：http://127.0.0.1:${server.address().port}`),
  );
}
