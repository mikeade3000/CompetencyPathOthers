const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

const GROQ_ENDPOINT  = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY   = process.env.GROQ_API_KEY;

// Ordered fallback cascade — tried in sequence on rate limit
const MODEL_CASCADE = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.get('/ping', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.post('/api/generate-step', async (req, res) => {
  const { prompt, model, stepLabel } = req.body || {};
  if (!prompt)       return res.status(400).json({ error: 'prompt is required' });
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set on server' });

  const complexSteps = ['Step 4','Step 5','Step 7','Step 8'];
  const maxTokens    = complexSteps.some(s => (stepLabel||'').includes(s)) ? 4096 : 2048;

  // Build cascade: requested model first, then fallbacks
  const requested = MODEL_CASCADE.includes(model) ? model : MODEL_CASCADE[0];
  const cascade   = [requested, ...MODEL_CASCADE.filter(m => m !== requested)];

  for (const tryModel of cascade) {
    // Retry same model twice (60s apart) before moving to next
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const groqRes = await fetch(GROQ_ENDPOINT, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + GROQ_API_KEY
          },
          body: JSON.stringify({
            model:           tryModel,
            messages:        [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature:     0.7,
            max_tokens:      maxTokens
          })
        });

        if (groqRes.ok) {
          const data    = await groqRes.json();
          const raw     = data?.choices?.[0]?.message?.content || '';
          const cleaned = raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
          try {
            return res.json(JSON.parse(cleaned));
          } catch {
            return res.status(502).json({ error: 'Model returned malformed JSON.' });
          }
        }

        const errData = await groqRes.json().catch(() => ({}));
        const msg     = errData?.error?.message || '';

        if (groqRes.status === 429) {
          // Rate limited — read Retry-After header or default to 62s
          const retryAfter = parseInt(groqRes.headers.get('retry-after') || '0', 10);
          const waitMs     = (retryAfter > 0 ? retryAfter : 62) * 1000;

          console.log(`[${stepLabel}] ${tryModel} rate-limited. Waiting ${waitMs/1000}s (attempt ${attempt}/2)...`);

          if (attempt < 2) {
            await sleep(waitMs);
            continue; // retry same model
          }
          // Both attempts exhausted — try next model in cascade
          console.log(`[${stepLabel}] ${tryModel} exhausted, trying next model...`);
          break;
        }

        // Non-rate-limit error — return immediately
        return res.status(groqRes.status).json({
          error: msg || `Groq HTTP ${groqRes.status}`
        });

      } catch (err) {
        console.error(`[${stepLabel}/${tryModel}] fetch error:`, err.message);
        if (attempt === 2) break;
        await sleep(5000);
      }
    }
  }

  // All models exhausted
  return res.status(429).json({
    error: 'All Groq models are rate-limited. Please wait 1-2 minutes and try again.'
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('CompetencyPath running on port ' + PORT));
