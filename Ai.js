// This is a test comment added by Antigravity AI to verify file modification
require('dotenv').config();
const { Mistral } = require('@mistralai/mistralai');
const apiKey1 = process.env.MISTRAL_API_KEY;
const apiKey2 = process.env.MISTRAL_API_KEY_2;
const apiKey3 = process.env.MISTRAL_API_KEY_3;

const apiKeys = [apiKey1, apiKey2, apiKey3].filter(Boolean);
if (apiKeys.length === 0) {
  console.error("❌ No Mistral API keys found in .env");
}

// Initialize Mistral clients
const clients = apiKeys.map(key => new Mistral({ apiKey: key }));
let currentClientIndex = 0;

// List of available Mistral models to bypass rate limits and distribute the load
const DEFAULT_MODELS = [
  // 'mistral-large-latest',
  // 'mistral-large-2512',
  // 'mistral-small-latest',
  // 'mistral-small-2603',
  // 'magistral-small-2509',
  'mistral-small-2506',
  // 'magistral-small-2509',
  // 'ministral-14b-2512',
  // 'mistral-medium-3-5',
  // 'mistral-medium-2508',
  // 'mistral-large-2512',
  // 'ministral-8b-2512',
  // 'ministral-3b-2512',
  // 'magistral-medium-2509'
  // 'open-mistral-nemo',
  // 'open-mixtral-8x22b'
];

let currentModelIndex = 0;

function getRoundRobinModelOrder() {
  if (DEFAULT_MODELS.length === 0) return [];

  // Pick the next model in a perfectly balanced circle
  const startIndex = currentModelIndex % DEFAULT_MODELS.length;
  currentModelIndex++;

  // Create an array that prioritizes the round-robin picked model first,
  // and then includes the rest of the models consecutively as fallbacks in case the first fails
  const order = [];
  for (let i = 0; i < DEFAULT_MODELS.length; i++) {
    order.push(DEFAULT_MODELS[(startIndex + i) % DEFAULT_MODELS.length]);
  }
  return order;
}

async function extractWithAI(cleanText) {
  let attempt = 0;
  const availableModels = getRoundRobinModelOrder();

  // Increase max attempts to 30! This gives the code enough patience to survive a full 60-second rate limit window without dropping a single request.
  while (attempt < 30 && availableModels.length > 0) {
    for (let i = 0; i < availableModels.length; i++) {
      const model = availableModels[i];
      let permanentError = false;

      // Instantly reserve a starting client index for pure round-robin across concurrent requests
      const startingClientIndex = currentClientIndex;
      if (clients.length > 0) {
        currentClientIndex = (currentClientIndex + 1) % clients.length;
      }

      // Key-Level Failover: Try all available keys for the current model BEFORE giving up on the model
      for (let c = 0; c < clients.length; c++) {
        const clientIndex = (startingClientIndex + c) % clients.length;
        const client = clients[clientIndex];

        try {
          const response = await client.chat.complete({
            messages: [{ role: 'user', content: cleanText }],
            model: model,
            temperature: 0.1,
            maxTokens: 8192, // Prevent JSON cutoff
            max_tokens: 8192 // Included as fallback for different SDK versions
          });

          const content = response.choices[0]?.message?.content;
          if (content) {
            console.log(`    ✅ Success with Mistral model: ${model} (Key Index: ${clientIndex})`);
            return content;
          }
        } catch (error) {
          const msg = (error.message || '').toLowerCase();
          const status = error.status || error.response?.status;

          // Identify permanent errors (Too large, Decommissioned, Bad Request, Not Found)
          if (msg.includes('maximum context length') ||
            msg.includes('token limit') ||
            msg.includes('too large') ||
            msg.includes('decommissioned') ||
            status === 404 ||
            status === 400) {
            // Remove this model permanently for this specific prompt so we don't spam it
            permanentError = true;
            break; // Break the CLIENT key loop to stop testing this failed model
          }

          // Rate Limits (429) -> Try the NEXT KEY (Client) for the SAME MODEL
          if (status === 429 || msg.includes('429') || msg.includes('rate limit')) {
            continue;
          }

          // Any other error, we just continue testing the next key
          continue;
        }
      } // End of keys loop

      if (permanentError) {
        availableModels.splice(i, 1);
        i--; // adjust index since we removed an element
      }
    } // End of models loop

    attempt++;
    if (attempt < 30 && availableModels.length > 0) {
      // Starts small (2s) and increases up to 10s between checking the whole pool again
      const baseWait = Math.min(2000 * attempt, 10000);
      // Exponential backoff to patiently survive 1-minute 
      const jitter = Math.floor(Math.random() * 1000); // 0-1s random jitter
      const waitTime = baseWait + jitter;

      console.warn(`    ⏳ Models busy or rate-limited (Attempt ${attempt}/30). Waiting ${Math.round(waitTime / 1000)}s for API limits to reset...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  console.error('❌ All Mistral models failed or rate limited after maximum retries. Request dropped.');
  return null;
}

module.exports = extractWithAI;