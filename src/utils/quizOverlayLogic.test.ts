import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_LIST,
  QuotaRouterEngine,
  buildModelChain,
  buildThinkingConfigForModel,
  formatAiOutput,
  isEligibleGeminiModel,
  maskKeyTail4,
  parseApiKeys,
   selectDefaultPreferredModel,
  sortModelsByStrength,
} from './quizOverlayLogic';

test('scoreModelStrength sorts default models in exact expected order', () => {
  const shuffled = [
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.7-flash',
  ];
  const sorted = sortModelsByStrength(shuffled);
  assert.deepEqual(sorted, DEFAULT_MODEL_LIST);
});

test('scoreModelStrength ranks pro > flash > flash-lite and stable > preview/exp', () => {
  const input = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash-preview-04-17',
    'gemini-3.5-flash',
    'gemini-3.5-pro',
    'gemini-3.8-flash',
  ];
  const sorted = sortModelsByStrength(input);
  assert.deepEqual(sorted, [
    'gemini-3.8-flash',
    'gemini-3.5-pro',
    'gemini-3.5-flash',
    'gemini-3.5-flash-preview-04-17',
    'gemini-3.5-flash-lite',
  ]);
});

test('isEligibleGeminiModel filters out non-text/multimodal models', () => {
  assert.equal(isEligibleGeminiModel('models/gemini-3.8-flash', ['generateContent']), true);
  assert.equal(isEligibleGeminiModel('models/text-embedding-004', ['embedContent']), false);
  assert.equal(isEligibleGeminiModel('models/gemini-embedding-exp', ['generateContent']), false);
  assert.equal(isEligibleGeminiModel('models/imagen-3.0', ['generateContent']), false);
  assert.equal(isEligibleGeminiModel('models/gemini-2.5-flash-tts', ['generateContent']), false);
});

test('selectDefaultPreferredModel prefers gemini-3.8-flash then latest flash', () => {
  assert.equal(selectDefaultPreferredModel(DEFAULT_MODEL_LIST), 'gemini-3.8-flash');
  const without38 = ['gemini-3.7-pro', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];
  assert.equal(selectDefaultPreferredModel(without38), 'gemini-3.7-flash');
});

test('buildModelChain never includes models stronger than preferredModel and limits to +5', () => {
  const chain = buildModelChain(DEFAULT_MODEL_LIST, 'gemini-3.6-flash', true);
  assert.equal(chain[0], 'gemini-3.6-flash');
  assert.equal(chain.includes('gemini-3.8-flash'), false);
  assert.equal(chain.includes('gemini-3.7-flash'), false);
  assert.deepEqual(chain, [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
  ]);

  const noFallback = buildModelChain(DEFAULT_MODEL_LIST, 'gemini-3.6-flash', false);
  assert.deepEqual(noFallback, ['gemini-3.6-flash']);
});

test('parseApiKeys trims, deduplicates, preserves order, max 5, and maskKeyTail4 shows only 4 chars', () => {
  const raw = [
    '  AIzaSyKeyOne1111  ',
    '',
    'AIzaSyKeyTwo2222',
    'AIzaSyKeyOne1111',
    'AIzaSyKeyThree3333',
    'AIzaSyKeyFour4444',
    'AIzaSyKeyFive5555',
    'AIzaSyKeySix6666',
  ].join('\n');

  const keys = parseApiKeys(raw);
  assert.equal(keys.length, 5);
  assert.equal(keys[0], 'AIzaSyKeyOne1111');
  assert.equal(keys[4], 'AIzaSyKeyFive5555');
  assert.equal(maskKeyTail4(keys[0]), '...1111');
});

test('buildThinkingConfigForModel uses thinkingBudget for 2.x and thinkingLevel for 3.x+', () => {
  const c25 = buildThinkingConfigForModel('gemini-2.5-flash', 'medium');
  assert.equal(c25.thinkingConfig?.thinkingBudget, 2048);
  assert.equal(c25.thinkingConfig?.thinkingLevel, undefined);
  assert.equal(c25.maxOutputTokens, 4096);

  const c38 = buildThinkingConfigForModel('gemini-3.8-flash', 'low');
  assert.equal(c38.thinkingConfig?.thinkingLevel, 'low');
  assert.equal(c38.thinkingConfig?.thinkingBudget, undefined);
  assert.equal(c38.maxOutputTokens, 2560);

  const unversioned = buildThinkingConfigForModel('gemini-flash-latest', 'high');
  assert.equal(unversioned.thinkingConfig, undefined);
  assert.equal(unversioned.maxOutputTokens, 2048);
});

test('QuotaRouter rotates across API keys first, then falls back to weaker model, and returns to preferred model when quota resets', () => {
  const router = new QuotaRouterEngine();
  const keys = ['key_A111', 'key_B222', 'key_C333'];
  const chain = ['gemini-3.8-flash', 'gemini-3.7-flash'];
  const t0 = 1_000_000;

  // Scan 1: API 1 gets 429 on 3.8-flash -> switches to API 2 and succeeds on 3.8-flash
  const res1 = router.executeRequest(
    keys,
    chain,
    'gemini-3.8-flash',
    (keyIdx, _key, model) => {
      if (model === 'gemini-3.8-flash' && keyIdx === 0) {
        return { type: 'HTTP_429' };
      }
      return { type: 'SUCCESS', answerText: 'Đáp án: B' };
    },
    t0
  );

  assert.equal(res1.ok, true);
  assert.equal(res1.modelUsed, 'gemini-3.8-flash');
  assert.equal(res1.apiIndex, 2);
  assert.equal(res1.isFallback, false);
  assert.equal(
    res1.steps.some((s) => s.overlayNotice === 'API 1 hết quota -> Đã chuyển sang API 2'),
    true
  );

  // Scan 2: API 2 & API 3 also get 429 on 3.8-flash -> falls back to gemini-3.7-flash on API 1!
  const res2 = router.executeRequest(
    keys,
    chain,
    'gemini-3.8-flash',
    (_keyIdx, _key, model) => {
      if (model === 'gemini-3.8-flash') {
        return { type: 'HTTP_429' };
      }
      return { type: 'SUCCESS', answerText: 'Đáp án: C' };
    },
    t0 + 5000
  );

  assert.equal(res2.ok, true);
  assert.equal(res2.modelUsed, 'gemini-3.7-flash');
  assert.equal(res2.apiIndex, 1);
  assert.equal(res2.isFallback, true);
  assert.equal(
    res2.steps.some(
      (s) =>
        s.overlayNotice ===
        'Model gemini-3.8-flash hết quota trên mọi API -> Đã chuyển sang gemini-3.7-flash'
    ),
    true
  );

  // Scan 3 after 31 minutes: quota cooldown expired -> automatically returns to preferred gemini-3.8-flash!
  const res3 = router.executeRequest(
    keys,
    chain,
    'gemini-3.8-flash',
    () => ({ type: 'SUCCESS', answerText: 'Đáp án: A' }),
    t0 + 31 * 60 * 1000
  );
  assert.equal(res3.ok, true);
  assert.equal(res3.modelUsed, 'gemini-3.8-flash');
  assert.equal(res3.isFallback, false);
});

test('formatAiOutput formats batch [#N]: prefixes cleanly', () => {
  const raw = '[#1]: B\n[#2]: D\n[#3]: A';
  assert.equal(formatAiOutput(raw, true), '1: B  2: D  3: A');
});
