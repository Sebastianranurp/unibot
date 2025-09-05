import 'dotenv/config';
import express from 'express';
import path from 'path';
import fetch from 'node-fetch';

const app = express();
const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 1) Creează un token efemer pt. Realtime (HTTP/SDP)
 *    Îl dăm browserului. Nu expunem cheia reală în client.
 */
app.get('/session', async (_req, res) => {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: process.env.REALTIME_VOICE || 'alloy',
        modalities: ['text', 'audio'],
        // Prompt de clinică – rămâne permanent pe sesiune
        instructions: [
          'Ești Unibot, asistent pentru clinica Imperial Dent.',
          'Vorbește EXCLUSIV în limba română (ro-RO). Ton cald, natural, concis.',
          'Când începi, dacă utilizatorul e prezent, poți deschide conversația politicos.',
          'Întreabă: aveți un control programat sau este o urgență? În ce pot ajuta?',
          'Fii scurt în răspunsuri și nu întrerupe utilizatorul.',
        ].join(' '),
        // VAD pe server => răspuns rapid, dar nu blocăm microfonul local
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          silence_duration_ms: 200
        }
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).send(t);
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

const port = process.env.PORT || 5050;
app.listen(port, () => {
  console.log(`Unibot dev server up: http://localhost:${port}`);
});
