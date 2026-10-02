'use strict';
// The hosted webhook store: POST {merge_variables, merge_strategy?, stream_limit?}.
// See https://github.com/usetrmnl/api-docs (private-plugins/webhooks.md).
const LIMITS = { standard: 2048, plus: 5120 };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
  return out;
}

// A test may pass the merge variables directly, a full webhook body, or a list of bodies.
function normalise(webhook) {
  if (Array.isArray(webhook)) return webhook.map((b) => normalise(b)[0]);
  if (isObj(webhook) && 'merge_variables' in webhook) return [webhook];
  return [{ merge_variables: webhook }];
}

class WebhookError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function apply(stored, body, { limit = 'standard' } = {}) {
  const max = typeof limit === 'number' ? limit : LIMITS[limit];
  const size = Buffer.byteLength(JSON.stringify(body));
  if (max && size > max) {
    throw new WebhookError(413, `webhook payload is ${size} bytes; TRMNL accepts ${max} (2048, or 5120 with TRMNL+)`);
  }
  if (!isObj(body.merge_variables)) throw new WebhookError(422, 'webhook body needs a merge_variables object');
  const incoming = body.merge_variables;
  switch (body.merge_strategy) {
    case undefined: case null: case '': case 'replace':
      return incoming;
    case 'deep_merge':
      return deepMerge(stored || {}, incoming);
    case 'stream': {
      const keep = Number(body.stream_limit) || Infinity;
      const out = { ...(stored || {}) };
      for (const [k, v] of Object.entries(incoming)) {
        out[k] = Array.isArray(v) ? [...(Array.isArray(out[k]) ? out[k] : []), ...v].slice(-keep) : v;
      }
      return out;
    }
    default:
      throw new WebhookError(422, `unknown merge_strategy "${body.merge_strategy}" (deep_merge or stream)`);
  }
}

function applyAll(stored, webhook, opts) {
  return normalise(webhook).reduce((acc, body) => apply(acc, body, opts), stored);
}

module.exports = { apply, applyAll, normalise, deepMerge, WebhookError, LIMITS };
