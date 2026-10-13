import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname } from 'node:path';

/** API 与页面共用 3100 来源，Cookie/CSRF 无需跨域代理；仅公开 public 内的静态资源。 */
export function registerFrontend(app: FastifyInstance) {
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };
  app.get('/*', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer');
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (
        path.startsWith('/api/') ||
        relative(root, file).startsWith('..') ||
        path.split('/').some((part) => part.startsWith('.')) ||
        !types[extname(file)]
      )
        return reply.code(404).send('Not found');
      return reply.type(types[extname(file)]).send(await readFile(file));
    } catch {
      return reply.code(404).send('Not found');
    }
  });
}
