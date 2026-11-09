import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Serves /api/assistant during `npm run dev`, the same way Vercel does
// online, using GEMINI_API_KEY from .env.local.
function assistantDevApi(env) {
  return {
    name: 'assistant-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/assistant', async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { /* bad JSON -> 400 below */ }
        const { handleAssistant } = await server.ssrLoadModule('/api/_agent.js');
        const out = await handleAssistant({ method: req.method, origin: req.headers.origin, ip: req.socket.remoteAddress, body, env });
        res.statusCode = out.status;
        for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
        if (out.json == null) return res.end();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out.json));
      });
    },
  };
}

// `npm run dev:https` serves the test site over https:// with a home-made
// certificate, so phones on the same Wi-Fi can use GPS (browsers block
// location on plain http:// addresses other than localhost).
export default defineConfig(({ mode }) => ({
  plugins: [react(), assistantDevApi(loadEnv(mode, process.cwd(), '')), ...(mode === 'https' ? [basicSsl()] : [])],
  build: { chunkSizeWarningLimit: 1500 },
}));
