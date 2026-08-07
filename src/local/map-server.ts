import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';

export interface MapServer {
  server: Server;
  url: string;
  maps: string[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!);
}

export async function startMapServer(files: string[]): Promise<MapServer> {
  const maps = files.map((file, index) => ({
    file: path.resolve(file),
    route: `/map/${index}/${encodeURIComponent(path.basename(file))}`,
  }));
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/' && maps.length === 1) {
      response.writeHead(302, { Location: maps[0]!.route }).end();
      return;
    }
    if (pathname === '/') {
      const links = maps.map(({ file, route }) =>
        `<li><a href="${route}">${escapeHtml(path.basename(file))}</a></li>`
      ).join('');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><meta charset="utf-8"><title>GEE Maps</title><ul>${links}</ul>`);
      return;
    }
    const map = maps.find(({ route }) => route === pathname);
    if (!map || !fs.existsSync(map.file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    fs.createReadStream(map.file).pipe(response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Map 服务启动失败');
  }
  const base = `http://127.0.0.1:${address.port}`;
  const urls = maps.map(({ route }) => base + route);
  return {
    server,
    url: maps.length === 1 ? urls[0]! : base + '/',
    maps: urls,
  };
}

export function openBrowser(url: string): void {
  let command: string;
  let args: string[];
  if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.env.WSL_DISTRO_NAME) {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export function closeMapServer(map: MapServer): Promise<void> {
  return new Promise((resolve) => map.server.close(() => resolve()));
}
