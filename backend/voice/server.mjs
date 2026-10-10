import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {PollyClient, SynthesizeSpeechCommand} from '@aws-sdk/client-polly';
import {TranscribeStreamingClient, StartStreamTranscriptionCommand} from '@aws-sdk/client-transcribe-streaming';
import {WebSocketServer, WebSocket} from 'ws';
import {audioQueue} from './queue.mjs';

const region = process.env.AWS_REGION || 'us-west-2';
const port = Number(process.env.PORT || 3001);
const polly = new PollyClient({region});
const transcribe = new TranscribeStreamingClient({region});
const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, process.env.FRONTEND_ORIGIN || 'http://localhost:5173']);
const files = new Map([['/', ['index.html', 'text/html']], ['/voice-client.js', ['voice-client.js', 'text/javascript']], ['/pcm-worklet.js', ['pcm-worklet.js', 'text/javascript']]]);
const json = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
function awsError(error) {
  if (['CredentialsProviderError', 'ExpiredTokenException', 'UnrecognizedClientException', 'InvalidClientTokenId'].includes(error.name)) return 'AWS credentials are missing or expired. Paste fresh Workshop Studio Mac/Linux exports into the Terminal and restart the server.';
  if (/AccessDenied/.test(error.name)) return 'The event AWS role does not allow this service. Ask an AWS event helper for Transcribe streaming and Polly access.';
  return 'AWS request failed. Check your connection, region, and event service permissions.';
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers.origin && !origins.has(req.headers.origin)) return json(res, 403, {error: 'Frontend origin is not allowed.'});
  if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}); return res.end(); }
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, {ok: true, region});
    if (req.method === 'GET' && files.has(req.url)) {
      const [name, type] = files.get(req.url); const data = await readFile(new URL(`./public/${name}`, import.meta.url));
      res.writeHead(200, {'Content-Type': type}); return res.end(data);
    }
    if (req.method !== 'POST' || req.url !== '/api/speech') return json(res, 404, {error: 'Not found'});
    let body = '', bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 16000) return json(res, 413, {error: 'Request too large'}); body += chunk; }
    let input; try { input = JSON.parse(body); } catch { return json(res, 400, {error: 'Send JSON containing text.'}); }
    if (typeof input?.text !== 'string' || !input.text.trim() || [...input.text].length > 3000) return json(res, 400, {error: 'Text must contain 1–3000 characters.'});
    const result = await polly.send(new SynthesizeSpeechCommand({Text: input.text.trim(), TextType: 'text', VoiceId: 'Joanna', Engine: 'neural', OutputFormat: 'mp3'}), {abortSignal: AbortSignal.timeout(30000)});
    const audio = await result.AudioStream.transformToByteArray();
    res.writeHead(200, {'Content-Type': 'audio/mpeg'}); res.end(Buffer.from(audio));
  } catch (error) { console.error('Request failed:', error.name); if (!res.headersSent) json(res, 502, {error: awsError(error)}); else res.end(); }
});
const sockets = new WebSocketServer({noServer: true, maxPayload: 32000});
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/transcribe' || !origins.has(req.headers.origin)) { socket.destroy(); return; }
  sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
});
sockets.on('connection', ws => {
  const queue = audioQueue(); const abort = new AbortController(); let started = false, stopped = false;
  const send = data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const fail = message => { send({type: 'error', message}); queue.end(); abort.abort(); ws.close(); };
  const timer = setTimeout(() => fail('Recording limit reached. Start a new recording.'), 5 * 60 * 1000);
  ws.on('close', () => { clearTimeout(timer); queue.end(); abort.abort(); });
  ws.on('error', () => { queue.end(); abort.abort(); });
  ws.on('message', async (data, binary) => {
    if (binary) {
      if (!started || stopped) return;
      if (data.length % 2) return fail('Invalid PCM audio.');
      try { queue.push(data); } catch (error) { fail(error.message); } return;
    }
    let message; try { message = JSON.parse(data.toString()); } catch { return fail('Invalid stream message.'); }
    if (message.type === 'stop') { stopped = true; queue.end(); return; }
    if (message.type !== 'start' || started || stopped || !Number.isInteger(message.sampleRate) || message.sampleRate < 8000 || message.sampleRate > 48000) return fail('Invalid recording configuration.');
    started = true;
    try {
      // Start capturing immediately: the SDK may need initial audio before responding.
      const response = await transcribe.send(new StartStreamTranscriptionCommand({LanguageCode: 'en-US', MediaEncoding: 'pcm', MediaSampleRateHertz: message.sampleRate, AudioStream: queue}), {abortSignal: abort.signal});
      for await (const event of response.TranscriptResultStream) {
        for (const result of event.TranscriptEvent?.Transcript?.Results || []) {
          send({type: 'transcript', id: result.ResultId, text: result.Alternatives?.[0]?.Transcript || '', isPartial: result.IsPartial});
        }
      }
      send({type: 'done'}); ws.close();
    } catch (error) { if (!abort.signal.aborted) { console.error('Transcribe failed:', error.name); fail(awsError(error)); } }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`CaseCoach voice: http://localhost:${port} (AWS ${region})`));
