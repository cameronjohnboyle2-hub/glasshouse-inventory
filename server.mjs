import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/assets/app.css', ['assets/app.css', 'text/css']],
  ['/assets/app.js', ['assets/app.js', 'text/javascript']],
  ['/assets/core.js', ['assets/core.js', 'text/javascript']],
]);
const port = Number(process.env.PORT || 8080);
createServer(async (request, response) => {
  const route = files.get(new URL(request.url, 'http://localhost').pathname);
  if (!route) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const content = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(500); response.end('Could not load the app.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Glasshouse is ready at http://localhost:${port}`));
