const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: '*' }));           // tighten to your domain in production

// ── Groq constants ──────────────────────────────────────────────
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY  = process.env.GROQ_API_KEY;   // set in Render → Environment

const ALLOWED_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192'
]);

// ── Health check ────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'ok', service: 'CompetencyPath API' }));

// ── Main proxy endpoint ─────────────────────────────────────────
// POST /api/generate-step
// Body: { prompt: string, model: string, stepLabel: string }
app.post('/api/generate-step', async (req, res) => {
  const { prompt, model, stepLabel } = req.body || {};

  if (!prompt)     return res.status(400).json({ error: 'prompt is required' });
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });

  // Sanitise model — fall back to best model if unknown
  const safeModel = ALLOWED_MODELS.has(model) ? model : 'llama-3.3-70b-versatile';

  // Complex steps need more output tokens
  const complexSteps = ['Step 4', 'Step 5', 'Step 7', 'Step 8'];
  const isComplex    = complexSteps.some(s => (stepLabel || '').includes(s));
  const maxTokens    = isComplex ? 4096 : 2048;

  try {
    const groqRes = await fetch(GROQ_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model:           safeModel,
        messages:        [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature:     0.7,
        max_tokens:      maxTokens
      })
    });

    const groqData = await groqRes.json();

    if (!groqRes.ok) {
      const msg = groqData?.error?.message || `Groq HTTP ${groqRes.status}`;
      return res.status(groqRes.status).json({ error: msg });
    }

    const rawText = groqData?.choices?.[0]?.message?.content || '';
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'Model returned malformed JSON. Try a shorter write-up.' });
    }

    return res.json(parsed);

  } catch (err) {
    console.error('[generate-step]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`CompetencyPath API listening on port ${PORT}`));
