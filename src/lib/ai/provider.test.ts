/**
 * DB-free unit tests for the AI provider config layer.
 * Run: node --import tsx --test src/lib/ai/provider.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBEDDING_DIMS,
  isAiConfigured,
  resolveAiConfig,
  type ProviderEnv,
} from './provider';

test('chat: AI_CHAT_* env wins and is returned verbatim (gateway prod shape)', () => {
  const env: ProviderEnv = {
    AI_CHAT_BASE_URL: 'https://ai-gateway.vercel.sh/v1/',
    AI_CHAT_MODEL: 'anthropic/claude-haiku-4-5',
    AI_CHAT_API_KEY: 'vck_test',
    // Legacy vars present but must NOT win over the explicit set.
    HERMES_API_URL: 'http://127.0.0.1:8642/v1',
    HERMES_API_KEY: 'local',
    AI_MODEL: 'gemma-4-e4b',
  };
  const cfg = resolveAiConfig('chat', env);
  assert.equal(cfg.baseURL, 'https://ai-gateway.vercel.sh/v1'); // trailing slash stripped
  assert.equal(cfg.model, 'anthropic/claude-haiku-4-5');
  assert.equal(cfg.apiKey, 'vck_test');
});

test('chat: falls back to legacy Hermes vars for local dev', () => {
  const env: ProviderEnv = {
    HERMES_API_URL: 'http://127.0.0.1:8642/v1',
    HERMES_API_KEY: 'local-key',
    AI_MODEL: 'gemma-4-e4b',
  };
  const cfg = resolveAiConfig('chat', env);
  assert.equal(cfg.baseURL, 'http://127.0.0.1:8642/v1');
  assert.equal(cfg.model, 'gemma-4-e4b');
  assert.equal(cfg.apiKey, 'local-key');
});

test('chat: defaults model to the gateway Haiku string when nothing names one', () => {
  const cfg = resolveAiConfig('chat', { AI_CHAT_BASE_URL: 'https://gw.example/v1' });
  assert.equal(cfg.model, 'anthropic/claude-haiku-4-5');
  assert.equal(cfg.apiKey, '');
});

test('chat: unconfigured throws a loud error naming the missing env vars', () => {
  assert.throws(
    () => resolveAiConfig('chat', {}),
    (err: Error) =>
      err.message.includes('AI_CHAT_BASE_URL') && err.message.includes('HERMES_API_URL'),
  );
});

test('embed: resolves AI_EMBED_* set with prod default model', () => {
  const cfg = resolveAiConfig('embed', {
    AI_EMBED_BASE_URL: 'https://ai-gateway.vercel.sh/v1',
    AI_EMBED_API_KEY: 'vck_embed',
  });
  assert.equal(cfg.baseURL, 'https://ai-gateway.vercel.sh/v1');
  assert.equal(cfg.model, 'openai/text-embedding-3-small');
  assert.equal(cfg.apiKey, 'vck_embed');
});

test('embed: dev override (Ollama nomic-embed-text) is honored', () => {
  const cfg = resolveAiConfig('embed', {
    AI_EMBED_BASE_URL: 'http://127.0.0.1:11434/v1/',
    AI_EMBED_MODEL: 'nomic-embed-text',
  });
  assert.equal(cfg.baseURL, 'http://127.0.0.1:11434/v1');
  assert.equal(cfg.model, 'nomic-embed-text');
  assert.equal(cfg.apiKey, '');
});

test('embed: has NO legacy fallback — Hermes vars alone still throw, naming AI_EMBED_BASE_URL', () => {
  assert.throws(
    () => resolveAiConfig('embed', { HERMES_API_URL: 'http://127.0.0.1:8642/v1' }),
    (err: Error) => err.message.includes('AI_EMBED_BASE_URL'),
  );
});

test('isAiConfigured mirrors resolution without throwing', () => {
  assert.equal(isAiConfigured('chat', {}), false);
  assert.equal(isAiConfigured('chat', { HERMES_API_URL: 'http://x/v1' }), true);
  assert.equal(isAiConfigured('chat', { AI_CHAT_BASE_URL: 'http://y/v1' }), true);
  assert.equal(isAiConfigured('embed', { HERMES_API_URL: 'http://x/v1' }), false);
  assert.equal(isAiConfigured('embed', { AI_EMBED_BASE_URL: 'http://z/v1' }), true);
});

test('blank/whitespace env values are treated as unset', () => {
  assert.equal(isAiConfigured('embed', { AI_EMBED_BASE_URL: '   ' }), false);
  assert.throws(() => resolveAiConfig('embed', { AI_EMBED_BASE_URL: '' }));
});

test('EMBEDDING_DIMS is pinned at 768 (schema + provider interchange contract)', () => {
  assert.equal(EMBEDDING_DIMS, 768);
});
