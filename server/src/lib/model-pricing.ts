export interface PricingResult {
  provider: string;
  model: string;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  inputRatePerMillionUsd: number | null;
  outputRatePerMillionUsd: number | null;
  pricingSource: string | null;
  pricingVersion: string | null;
  priceKnown: boolean;
}

type PricingRule = {
  provider: string;
  matches: string[];
  inputRatePerMillionUsd: number;
  outputRatePerMillionUsd: number;
  pricingSource: string;
  pricingVersion: string;
};

const pricingRules: PricingRule[] = [
  {
    provider: 'gemini',
    matches: ['gemini-3.1-flash-lite-preview'],
    inputRatePerMillionUsd: 0.25,
    outputRatePerMillionUsd: 1.5,
    pricingSource: 'https://ai.google.dev/gemini-api/docs/pricing',
    pricingVersion: '2026-03-17',
  },
  {
    provider: 'gemini',
    matches: ['gemini-2.0-flash-lite'],
    inputRatePerMillionUsd: 0.075,
    outputRatePerMillionUsd: 0.3,
    pricingSource: 'https://ai.google.dev/gemini-api/docs/pricing',
    pricingVersion: '2026-03-17',
  },
];

function normalizeProvider(provider?: string | null) {
  return String(provider || 'unknown').trim().toLowerCase();
}

function normalizeModel(model?: string | null) {
  return String(model || 'unknown').trim().toLowerCase();
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function calculateModelCost(params: {
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): PricingResult {
  const provider = normalizeProvider(params.provider);
  const model = normalizeModel(params.model);
  const inputTokens = Number(params.inputTokens || 0);
  const outputTokens = Number(params.outputTokens || 0);

  const rule = pricingRules.find((candidate) => {
    return candidate.provider === provider && candidate.matches.some((match) => model === match || model.startsWith(`${match}-`));
  });

  if (!rule) {
    return {
      provider,
      model,
      inputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
      inputRatePerMillionUsd: null,
      outputRatePerMillionUsd: null,
      pricingSource: null,
      pricingVersion: null,
      priceKnown: false,
    };
  }

  const inputCostUsd = roundUsd((inputTokens / 1_000_000) * rule.inputRatePerMillionUsd);
  const outputCostUsd = roundUsd((outputTokens / 1_000_000) * rule.outputRatePerMillionUsd);

  return {
    provider,
    model,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: roundUsd(inputCostUsd + outputCostUsd),
    inputRatePerMillionUsd: rule.inputRatePerMillionUsd,
    outputRatePerMillionUsd: rule.outputRatePerMillionUsd,
    pricingSource: rule.pricingSource,
    pricingVersion: rule.pricingVersion,
    priceKnown: true,
  };
}
