/**
 * Core domain logic for QuizSnap Overlay (com.example.quizoverlay)
 * Mirrors the exact Kotlin implementation in ModelStrengthScorer, SecureKeyStore,
 * GeminiClient (thinkingConfig compatibility), and QuotaRouter.
 */

export type ThinkingLevel = 'low' | 'medium' | 'high';

export type ApiKeyStatusType = 'READY' | 'ACTIVE' | 'QUOTA_EXHAUSTED' | 'INVALID_KEY';

export interface ApiSlotStatus {
  apiIndex: number; // 1-based
  keyTail4: string; // e.g. "...a1B2"
  status: ApiKeyStatusType;
  cooldownRemainingMs: number;
}

export interface ActiveRouteState {
  isServiceRunning: boolean;
  hasScannedInSession: boolean;
  modelUsed: string;
  preferredModel: string;
  apiIndex: number; // 1-based
  apiCount: number;
  keyTail4: string;
  isFallback: boolean;
  lastScanTime: string | null;
  lastLatencyMs: number | null;
  apiStatuses: ApiSlotStatus[];
  transitionNotice: string | null;
}

export const DEFAULT_MODEL_LIST: string[] = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
];

export const QUOTA_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

const VERSION_REGEX = /^gemini-(\d+)(?:\.(\d+))?/i;
const NON_TEXT_KEYWORDS = [
  'embedding',
  'imagen',
  'veo',
  'tts',
  'aqa',
  'bisheng',
  'learnlm',
  'audio',
];

export function normalizeModelName(rawName: string): string {
  return rawName.trim().replace(/^models\//i, '');
}

export function isEligibleGeminiModel(
  rawName: string,
  supportedGenerationMethods?: string[]
): boolean {
  const name = normalizeModelName(rawName).toLowerCase();
  if (!name.startsWith('gemini-')) return false;
  if (
    supportedGenerationMethods &&
    !supportedGenerationMethods.includes('generateContent')
  ) {
    return false;
  }
  for (const blocked of NON_TEXT_KEYWORDS) {
    if (name.includes(blocked)) return false;
  }
  return true;
}

export interface ModelStrengthScore {
  major: number;
  minor: number;
  tier: number; // 3 = pro, 2 = flash (including -latest), 1 = flash-lite, 0 = other
  stability: number; // 1 = stable, 0 = preview / exp / date release
  name: string;
}

export function scoreModelStrength(rawModelName: string): ModelStrengthScore {
  const name = normalizeModelName(rawModelName).toLowerCase();
  const match = VERSION_REGEX.exec(name);
  const major = match ? parseInt(match[1], 10) : 0;
  const minor = match && match[2] !== undefined ? parseInt(match[2], 10) : 0;

  let tier = 0;
  if (name.includes('flash-lite') || name.includes('lite')) {
    tier = 1;
  } else if (name.includes('pro')) {
    tier = 3;
  } else if (name.includes('flash')) {
    tier = 2;
  }

  const isPreviewOrDated =
    name.includes('preview') ||
    name.includes('exp') ||
    /-\d{2}-\d{2}/.test(name) ||
    /-\d{4}/.test(name) ||
    /-\d{3}$/.test(name);
  const stability = isPreviewOrDated ? 0 : 1;

  return {
    major,
    minor,
    tier,
    stability,
    name,
  };
}

export function compareModelsByStrength(a: string, b: string): number {
  const sa = scoreModelStrength(a);
  const sb = scoreModelStrength(b);

  if (sa.major !== sb.major) return sb.major - sa.major;
  if (sa.minor !== sb.minor) return sb.minor - sa.minor;
  if (sa.tier !== sb.tier) return sb.tier - sa.tier;
  if (sa.stability !== sb.stability) return sb.stability - sa.stability;
  return sa.name.localeCompare(sb.name);
}

export function sortModelsByStrength(models: string[]): string[] {
  const unique = Array.from(
    new Set(models.map((m) => normalizeModelName(m)).filter(Boolean))
  );
  return unique.sort(compareModelsByStrength);
}

export function selectDefaultPreferredModel(sortedModels: string[]): string {
  if (sortedModels.includes('gemini-3.8-flash')) {
    return 'gemini-3.8-flash';
  }
  const latestFlash = sortedModels.find((m) => {
    const lower = m.toLowerCase();
    return lower.includes('flash') && !lower.includes('flash-lite') && !lower.includes('lite');
  });
  if (latestFlash) return latestFlash;
  return sortedModels[0] || 'gemini-3.8-flash';
}

/**
 * Chain = [preferredModel] + at most 5 models strictly BELOW preferredModel
 * in the strength-sorted list. Never includes a model stronger than preferredModel.
 */
export function buildModelChain(
  availableModels: string[],
  preferredModel: string,
  autoFallback: boolean
): string[] {
  const cleanPreferred = normalizeModelName(preferredModel) || 'gemini-3.8-flash';
  if (!autoFallback) {
    return [cleanPreferred];
  }
  const merged = sortModelsByStrength(
    availableModels.includes(cleanPreferred)
      ? availableModels
      : [cleanPreferred, ...availableModels]
  );
  const startIndex = merged.indexOf(cleanPreferred);
  if (startIndex === -1) {
    return [cleanPreferred];
  }
  return merged.slice(startIndex, startIndex + 6);
}

/**
 * Parse API keys: trim, remove empty lines, deduplicate preserving input order, max 5.
 */
export function parseApiKeys(rawInput: string): string[] {
  const lines = rawInput.split(/\r?\n/);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
      if (result.length >= 5) break;
    }
  }
  return result;
}

/**
 * Returns only the last 4 characters of an API key, prefixed with "..."
 */
export function maskKeyTail4(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '...????';
  const tail = trimmed.slice(-4);
  return `...${tail}`;
}

export interface ThinkingConfigPayload {
  maxOutputTokens: number;
  thinkingConfig?: {
    thinkingBudget?: number;
    thinkingLevel?: 'low' | 'medium' | 'high';
  };
}

export function buildThinkingConfigForModel(
  modelName: string,
  level: ThinkingLevel
): ThinkingConfigPayload {
  const clean = normalizeModelName(modelName).toLowerCase();
  const match = VERSION_REGEX.exec(clean);
  const budgetMap: Record<ThinkingLevel, number> = {
    low: 512,
    medium: 2048,
    high: 8192,
  };
  const budget = budgetMap[level] ?? 512;

  if (!match) {
    return {
      maxOutputTokens: 2048,
    };
  }

  const major = parseInt(match[1], 10);
  if (major === 2) {
    const minBudget = clean.includes('pro') ? 128 : 0;
    const effectiveBudget = Math.max(minBudget, budget);
    return {
      maxOutputTokens: 2048 + effectiveBudget,
      thinkingConfig: {
        thinkingBudget: effectiveBudget,
      },
    };
  }

  if (major >= 3) {
    return {
      maxOutputTokens: 2048 + budget,
      thinkingConfig: {
        thinkingLevel: level,
      },
    };
  }

  return {
    maxOutputTokens: 2048,
  };
}

export function formatAiOutput(rawText: string, isBatch = false): string {
  const cleaned = rawText
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .trim();

  if (!isBatch) {
    return cleaned.replace(/\n{3,}/g, '\n\n');
  }

  const regex = /\[#(\d+)\]\s*:\s*([^\n]+(?:\n(?!\[#\d+\]\s*:)[^\n]+)*)/g;
  const matches: Array<{ index: string; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    matches.push({
      index: match[1],
      text: match[2].replace(/\s+/g, ' ').trim(),
    });
  }

  if (matches.length > 0) {
    const allShort = matches.every((m) => m.text.length <= 18);
    if (allShort) {
      return matches.map((m) => `${m.index}: ${m.text}`).join('  ');
    }
    return matches.map((m) => `${m.index}: ${m.text}`).join('\n');
  }

  return cleaned;
}

export function mmToDp(mm: number): number {
  // 1 inch = 25.4 mm, 160 dp = 1 inch => 1 mm = 160 / 25.4 ≈ 6.2992 dp
  return Math.round(mm * (160 / 25.4));
}

export type SimulatedApiOutcome =
  | { type: 'SUCCESS'; answerText: string; latencyMs?: number }
  | {
      type: 'HTTP_429';
      isRateLimitPerMinute?: boolean;
      retrySucceeds?: boolean;
      retryAnswerText?: string;
      message?: string;
    }
  | { type: 'HTTP_400_INVALID_KEY'; httpCode?: 400 | 403; message?: string }
  | { type: 'HTTP_503_OVERLOAD'; recoverOnAttempt?: number; answerText?: string }
  | { type: 'HTTP_404_NOT_FOUND'; message?: string }
  | { type: 'NETWORK_ERROR'; message?: string };

export interface QuotaRouteStepLog {
  model: string;
  apiIndex: number; // 1-based
  outcome: string;
  overlayNotice?: string;
}

export interface QuotaExecutionResult {
  ok: boolean;
  displayMessage: string;
  modelUsed: string;
  apiIndex: number; // 1-based
  isFallback: boolean;
  steps: QuotaRouteStepLog[];
}

/**
 * Deterministic QuotaRouter state machine mirroring QuotaRouter.kt
 */
export class QuotaRouterEngine {
  private activeKeyIndex = 0; // 0-based
  private exhaustedUntil = new Map<string, number>(); // key `${keyIdx}::${model}` -> timestamp ms
  private invalidKeys = new Set<number>(); // 0-based key index
  private deadModels = new Set<string>();

  private pairKey(keyIdx: number, model: string): string {
    return `${keyIdx}::${normalizeModelName(model)}`;
  }

  public resetAll(): void {
    this.activeKeyIndex = 0;
    this.exhaustedUntil.clear();
    this.invalidKeys.clear();
    this.deadModels.clear();
  }

  public getActiveKeyIndex(): number {
    return this.activeKeyIndex;
  }

  public setActiveKeyIndex(idx: number): void {
    this.activeKeyIndex = Math.max(0, idx);
  }

  public markKeyExhausted(keyIdx: number, model: string, nowMs = Date.now()): void {
    this.exhaustedUntil.set(this.pairKey(keyIdx, model), nowMs + QUOTA_COOLDOWN_MS);
  }

  public markKeyInvalid(keyIdx: number): void {
    this.invalidKeys.add(keyIdx);
  }

  public clearKeyStatesForModel(model: string): void {
    for (const k of Array.from(this.exhaustedUntil.keys())) {
      if (k.endsWith(`::${normalizeModelName(model)}`)) {
        this.exhaustedUntil.delete(k);
      }
    }
  }

  public isPairExhausted(keyIdx: number, model: string, nowMs = Date.now()): boolean {
    const until = this.exhaustedUntil.get(this.pairKey(keyIdx, model));
    if (!until) return false;
    if (nowMs >= until) {
      this.exhaustedUntil.delete(this.pairKey(keyIdx, model));
      return false;
    }
    return true;
  }

  public getRemainingCooldownMs(keyIdx: number, model: string, nowMs = Date.now()): number {
    const until = this.exhaustedUntil.get(this.pairKey(keyIdx, model));
    if (!until) return 0;
    const rem = until - nowMs;
    if (rem <= 0) {
      this.exhaustedUntil.delete(this.pairKey(keyIdx, model));
      return 0;
    }
    return rem;
  }

  public buildApiSlotStatuses(
    keys: string[],
    currentModel: string,
    isActivelyUsing: boolean,
    nowMs = Date.now()
  ): ApiSlotStatus[] {
    return keys.map((key, idx) => {
      const tail4 = maskKeyTail4(key);
      if (this.invalidKeys.has(idx)) {
        return {
          apiIndex: idx + 1,
          keyTail4: tail4,
          status: 'INVALID_KEY',
          cooldownRemainingMs: 0,
        };
      }
      const rem = this.getRemainingCooldownMs(idx, currentModel, nowMs);
      if (rem > 0) {
        return {
          apiIndex: idx + 1,
          keyTail4: tail4,
          status: 'QUOTA_EXHAUSTED',
          cooldownRemainingMs: rem,
        };
      }
      if (isActivelyUsing && idx === this.activeKeyIndex) {
        return {
          apiIndex: idx + 1,
          keyTail4: tail4,
          status: 'ACTIVE',
          cooldownRemainingMs: 0,
        };
      }
      return {
        apiIndex: idx + 1,
        keyTail4: tail4,
        status: 'READY',
        cooldownRemainingMs: 0,
      };
    });
  }

  public executeRequest(
    keys: string[],
    modelChain: string[],
    preferredModel: string,
    callFn: (keyIndex: number, key: string, model: string) => SimulatedApiOutcome,
    nowMs = Date.now(),
    onRouteChanged?: (model: string, apiIndex1Based: number, notice: string) => void
  ): QuotaExecutionResult {
    const steps: QuotaRouteStepLog[] = [];
    if (keys.length === 0) {
      return {
        ok: false,
        displayMessage: 'Vui lòng nhập ít nhất một API key.',
        modelUsed: preferredModel,
        apiIndex: 1,
        isFallback: false,
        steps,
      };
    }

    const usableModels = modelChain.filter((m) => !this.deadModels.has(m));
    if (usableModels.length === 0) {
      return {
        ok: false,
        displayMessage: 'Tất cả API và model đã hết quota. Hãy đợi reset hoặc thêm key mới.',
        modelUsed: preferredModel,
        apiIndex: (this.activeKeyIndex % keys.length) + 1,
        isFallback: false,
        steps,
      };
    }

    for (let mIdx = 0; mIdx < usableModels.length; mIdx++) {
      const model = usableModels[mIdx];
      // If we fell back to a secondary model after preferred model exhausted all keys,
      // start from the first non-exhausted key (index 0) as required by section 8.1:
      // "bắt đầu lại từ API đầu chưa bị đánh dấu"
      const startKeyIdx = mIdx === 0 ? this.activeKeyIndex % keys.length : 0;

      let triedAnyKeyOnModel = false;
      let notFoundCountOnModel = 0;
      let overloadedModelAbort = false;

      for (let offset = 0; offset < keys.length; offset++) {
        const keyIdx = (startKeyIdx + offset) % keys.length;
        const apiNum = keyIdx + 1;

        if (this.invalidKeys.has(keyIdx)) {
          continue;
        }
        if (this.isPairExhausted(keyIdx, model, nowMs)) {
          continue;
        }

        triedAnyKeyOnModel = true;
        const outcome = callFn(keyIdx, keys[keyIdx], model);

        if (outcome.type === 'SUCCESS') {
          this.activeKeyIndex = keyIdx;
          steps.push({ model, apiIndex: apiNum, outcome: 'SUCCESS' });
          return {
            ok: true,
            displayMessage: outcome.answerText,
            modelUsed: model,
            apiIndex: apiNum,
            isFallback: normalizeModelName(model) !== normalizeModelName(preferredModel),
            steps,
          };
        }

        if (outcome.type === 'NETWORK_ERROR') {
          // Do NOT change activeKeyIndex or model on network error
          steps.push({ model, apiIndex: apiNum, outcome: 'NETWORK_ERROR' });
          return {
            ok: false,
            displayMessage: 'Kiểm tra lại kết nối mạng.',
            modelUsed: model,
            apiIndex: apiNum,
            isFallback: normalizeModelName(model) !== normalizeModelName(preferredModel),
            steps,
          };
        }

        if (outcome.type === 'HTTP_400_INVALID_KEY') {
          this.invalidKeys.add(keyIdx);
          const code = outcome.httpCode ?? 400;
          const notice = `API ${apiNum} không hợp lệ (HTTP ${code})`;
          steps.push({
            model,
            apiIndex: apiNum,
            outcome: `HTTP_${code}_INVALID_KEY`,
            overlayNotice: notice,
          });
          const nextValidKey = this.findNextAvailableKey(keys.length, keyIdx, model, nowMs);
          if (nextValidKey !== -1) {
            this.activeKeyIndex = nextValidKey;
            onRouteChanged?.(model, nextValidKey + 1, notice);
          }
          continue;
        }

        if (outcome.type === 'HTTP_404_NOT_FOUND') {
          notFoundCountOnModel++;
          steps.push({ model, apiIndex: apiNum, outcome: 'HTTP_404' });
          continue;
        }

        if (outcome.type === 'HTTP_503_OVERLOAD') {
          // Retry same key up to 2 times without marking quota exhausted
          if (outcome.recoverOnAttempt && outcome.recoverOnAttempt <= 2) {
            this.activeKeyIndex = keyIdx;
            steps.push({ model, apiIndex: apiNum, outcome: 'HTTP_503_RECOVERED' });
            return {
              ok: true,
              displayMessage: outcome.answerText || 'B',
              modelUsed: model,
              apiIndex: apiNum,
              isFallback: normalizeModelName(model) !== normalizeModelName(preferredModel),
              steps,
            };
          }
          steps.push({ model, apiIndex: apiNum, outcome: 'HTTP_503_MODEL_OVERLOADED' });
          overloadedModelAbort = true;
          break; // Move to next model in chain without marking key quota exhausted
        }

        if (outcome.type === 'HTTP_429') {
          if (outcome.isRateLimitPerMinute && outcome.retrySucceeds) {
            this.activeKeyIndex = keyIdx;
            steps.push({ model, apiIndex: apiNum, outcome: 'HTTP_429_RETRY_OK' });
            return {
              ok: true,
              displayMessage: outcome.retryAnswerText || 'A',
              modelUsed: model,
              apiIndex: apiNum,
              isFallback: normalizeModelName(model) !== normalizeModelName(preferredModel),
              steps,
            };
          }

          // Mark (keyIdx, model) exhausted for 30 minutes
          this.markKeyExhausted(keyIdx, model, nowMs);
          const nextKey = this.findNextAvailableKey(keys.length, keyIdx, model, nowMs);
          if (nextKey !== -1) {
            this.activeKeyIndex = nextKey;
            const notice = `API ${apiNum} hết quota -> Đã chuyển sang API ${nextKey + 1}`;
            steps.push({
              model,
              apiIndex: apiNum,
              outcome: 'HTTP_429_SWITCH_KEY',
              overlayNotice: notice,
            });
            onRouteChanged?.(model, nextKey + 1, notice);
          } else {
            steps.push({
              model,
              apiIndex: apiNum,
              outcome: 'HTTP_429_ALL_KEYS_EXHAUSTED_ON_MODEL',
            });
          }
        }
      }

      if (notFoundCountOnModel > 0 && notFoundCountOnModel >= keys.length - this.invalidKeys.size) {
        this.deadModels.add(model);
      }

      // Check if there is a next model to fall back to
      if (mIdx + 1 < usableModels.length) {
        const nextModel = usableModels[mIdx + 1];
        const firstKeyForNextModel = this.findFirstAvailableKeyFromZero(
          keys.length,
          nextModel,
          nowMs
        );
        if (firstKeyForNextModel !== -1) {
          this.activeKeyIndex = firstKeyForNextModel;
          const notice = overloadedModelAbort
            ? `Model ${model} quá tải -> Đã chuyển sang ${nextModel}`
            : `Model ${model} hết quota trên mọi API -> Đã chuyển sang ${nextModel}`;
          steps.push({
            model,
            apiIndex: firstKeyForNextModel + 1,
            outcome: 'SWITCH_MODEL',
            overlayNotice: notice,
          });
          onRouteChanged?.(nextModel, firstKeyForNextModel + 1, notice);
        }
      } else if (!triedAnyKeyOnModel) {
        // Nothing left
      }
    }

    return {
      ok: false,
      displayMessage: 'Tất cả API và model đã hết quota. Hãy đợi reset hoặc thêm key mới.',
      modelUsed: usableModels[usableModels.length - 1] || preferredModel,
      apiIndex: (this.activeKeyIndex % keys.length) + 1,
      isFallback:
        usableModels.length > 1 &&
        normalizeModelName(usableModels[usableModels.length - 1]) !==
          normalizeModelName(preferredModel),
      steps,
    };
  }

  private findNextAvailableKey(
    keyCount: number,
    afterKeyIdx: number,
    model: string,
    nowMs: number
  ): number {
    for (let offset = 1; offset < keyCount; offset++) {
      const candidate = (afterKeyIdx + offset) % keyCount;
      if (this.invalidKeys.has(candidate)) continue;
      if (this.isPairExhausted(candidate, model, nowMs)) continue;
      return candidate;
    }
    return -1;
  }

  private findFirstAvailableKeyFromZero(
    keyCount: number,
    model: string,
    nowMs: number
  ): number {
    for (let idx = 0; idx < keyCount; idx++) {
      if (this.invalidKeys.has(idx)) continue;
      if (this.isPairExhausted(idx, model, nowMs)) continue;
      return idx;
    }
    return -1;
  }
}
