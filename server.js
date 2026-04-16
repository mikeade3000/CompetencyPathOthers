const express = require('express');
const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — must be first, before body parser and routes ─────────
// Handle preflight for ALL routes
app.options('*', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age':       '86400'
  });
  return res.sendStatus(204);
});

// Inject CORS headers on every response
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept'
  });
  next();
});

// ── Body parser ─────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Groq ─────────────────────────────────────────────────────────
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY  = process.env.GROQ_API_KEY;
const ALLOWED_MODELS = new Set([
  'llama-3.3-70b-versatile','llama-3.1-8b-instant',
  'llama3-70b-8192','llama3-8b-8192'
]);

// ── Health / wake-up ─────────────────────────────────────────────
app.get('/',     (_req, res) => res.json({ status:'ok', service:'CompetencyPath API', ts:Date.now() }));
app.get('/ping', (_req, res) => res.json({ status:'ok', ts:Date.now() }));

// ── Main generation endpoint ─────────────────────────────────────
app.post('/api/generate-step', async (req, res) => {
  const { prompt, model, stepLabel } = req.body || {};

  if (!prompt)       return res.status(400).json({ error:'prompt is required' });
  if (!GROQ_API_KEY) return res.status(500).json({ error:'GROQ_API_KEY not configured on server' });

  const safeModel = ALLOWED_MODELS.has(model) ? model : 'llama-3.3-70b-versatile';
  const complexSteps = ['Step 4','Step 5','Step 7','Step 8'];
  const maxTokens    = complexSteps.some(s => (stepLabel||'').includes(s)) ? 4096 : 2048;

  try{
    const groqRes = await fetch(GROQ_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model:           safeModel,
        messages:        [{ role:'user', content:prompt }],
        response_format: { type:'json_object' },
        temperature:     0.7,
        max_tokens:      maxTokens
      })
    });

    const groqData = await groqRes.json();
    if(!groqRes.ok){
      return res.status(groqRes.status).json({
        error: groqData?.error?.message || 'Groq HTTP ' + groqRes.status
      });
    }

    const rawText = groqData?.choices?.[0]?.message?.content || '';
    const cleaned = rawText.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();

    try{
      return res.json(JSON.parse(cleaned));
    }catch{
      return res.status(502).json({ error:'Model returned malformed JSON. Try a shorter write-up.' });
    }

  }catch(err){
    console.error('[generate-step]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.listen(PORT, () => console.log('CompetencyPath API on port ' + PORT));
