// api/proxy.js
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { path } = req.query;           // e.g. fs/readdir, ai/txt2img, chat/completions
  const body = req.body || {};

  const puterToken = process.env.PUTER_TOKEN;
  if (!puterToken) {
    return res.status(500).json({ error: 'Puter token not configured' });
  }

  const segments = path.split('/');
  const category = segments[0];
  const method = segments.slice(1).join('/');

  let puterEndpoint = '';
  let payload = body;

  // Map to real Puter driver endpoints
  switch (category) {
    case 'fs':
      puterEndpoint = method === 'readdir' ? '/readdir' :
                      method === 'read'    ? '/read'    :
                      method === 'write'   ? '/batch'   : '/unknown';
      break;
    case 'ai':
      if (method === 'txt2img')     puterEndpoint = '/drivers/call'; payload = { interface: 'puter-image-generation', driver: 'ai-image', method: 'generate', args: body };
      if (method === 'chat')        puterEndpoint = '/drivers/call'; payload = { interface: 'puter-chat-completion', driver: 'ai-chat', method: 'complete', args: body };
      break;
    case 'kv':
      puterEndpoint = '/drivers/call'; payload = { interface: 'puter-kvstore', method, args: body };
      break;
    case 'chat':
    case 'completions':           // OpenAI compatibility
      puterEndpoint = '/drivers/call';
      payload = {
        interface: 'puter-chat-completion',
        driver: 'ai-chat',
        method: 'complete',
        args: { messages: body.messages, model: body.model || 'gpt-4o-mini', stream: body.stream || false }
      };
      break;
    default:
      return res.status(400).json({ error: 'Unknown category' });
  }

  if (puterEndpoint === '/unknown') {
    return res.status(400).json({ error: 'Unsupported method' });
  }

  try {
    const response = await fetch(`https://api.puter.com${puterEndpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${puterToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    // Stream support for chat completions
    if (body.stream && response.headers.get('content-type')?.includes('ndjson')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Forward NDJSON stream (Puter uses NDJSON for streaming)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(`data: ${decoder.decode(value)}\n\n`);
      }
      res.end();
      return;
    }

    res.status(response.status).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
}

// Vercel needs this for proper routing
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',   // allow reasonably big payloads
    },
  },
};
