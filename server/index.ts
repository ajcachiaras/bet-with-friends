import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { loadUser } from './auth.js';
import { HttpError } from './http.js';
import { api } from './routes.js';

const app = express();
// `--port=N` wins over $PORT so the dev script can pin the API to the port the
// Vite proxy expects, even when a tool sets PORT for the whole process tree.
const portArg = process.argv.find((a) => a.startsWith('--port='))?.slice('--port='.length);
const port = Number(portArg ?? process.env.PORT ?? 3001);

app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(loadUser);
app.use('/api', api);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// In production the built web app is served from the same origin as the API.
const webDist = path.resolve('dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(port, () => {
  console.log(`Bet with Friends API listening on http://localhost:${port}`);
});
