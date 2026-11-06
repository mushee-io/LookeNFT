/**
 * LookeNFT browser-only generative art planner.
 * No wallet, backend mutations, hosted URLs or minting occur in this module.
 */
export type TraitVariant = { id: string; name: string; weight: number };
export type TraitLayer = { id: string; name: string; variants: TraitVariant[] };
export type GeneratedToken = { tokenId: number; picks: number[]; score: number };
export type GenerationPlan = {
  seed: string;
  supply: number;
  capacity: string;
  tokens: GeneratedToken[];
  counts: number[][];
  ranks: number[];
};

function hashSeed(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash || 1;
}

function seededRandom(input: string): () => number {
  let state = hashSeed(input) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validateLayers(layers: TraitLayer[], supply: number) {
  if (!Number.isSafeInteger(supply) || supply < 1 || supply > 10000)
    throw Error("Supply must be between 1 and 10,000 unique characters.");
  if (layers.length < 2 || layers.length > 12)
    throw Error("Upload at least two artwork layers (up to 12) to generate unique characters.");
  const names = new Set<string>();
  const active = layers.map(layer => {
    if (!layer.name.trim() || layer.name.length > 48)
      throw Error("Each layer needs a name up to 48 characters.");
    const key = layer.name.trim().toLowerCase();
    if (names.has(key)) throw Error("Layer names must be unique.");
    names.add(key);
    if (!layer.variants.length || layer.variants.length > 60)
      throw Error("Each layer needs 1–60 uploaded transparent PNG variations.");
    const variants = layer.variants.map((v, index) => ({ ...v, index }));
    const labels = new Set<string>();
    for (const v of variants) {
      if (!v.name.trim() || v.name.length > 64)
        throw Error("Each artwork variation needs a name up to 64 characters.");
      if (labels.has(v.name.trim().toLowerCase()))
        throw Error("Duplicate variation name in " + layer.name + ": " + v.name);
      labels.add(v.name.trim().toLowerCase());
      if (!Number.isSafeInteger(v.weight) || v.weight < 0 || v.weight > 1000)
        throw Error("Rarity weight must be a whole number between 0 and 1000.");
    }
    const enabled = variants.filter(v => v.weight > 0);
    if (!enabled.length) throw Error("At least one rarity weight in " + layer.name + " must exceed zero.");
    return enabled;
  });
  const capacity = active.reduce((acc, opts) => acc * BigInt(opts.length), 1n);
  if (capacity < BigInt(supply))
    throw Error("Only " + capacity.toString() + " distinct combinations are possible. Add more trait variations or lower the supply from " + supply + ".");
  return { active, capacity };
}

export function generatePlan(layers: TraitLayer[], supply: number, seed: string): GenerationPlan {
  if (!seed || seed.length > 128) throw Error("Enter a reproducible generation seed (1–128 characters).");
  const { active, capacity } = validateLayers(layers, supply);
  const random = seededRandom(seed);
  const counts = layers.map(layer => layer.variants.map(() => 0));
  const used = new Set<string>();
  const tokens: GeneratedToken[] = [];
  let fallbackCursor = BigInt(hashSeed(seed)) % capacity;
  function encode(picks: number[]): string { return picks.join(","); }
  function decode(rank: bigint): number[] {
    const picks = new Array<number>(active.length);
    for (let layer = active.length - 1; layer >= 0; layer--) {
      const n = BigInt(active[layer].length);
      picks[layer] = Number(rank % n);
      rank /= n;
    }
    return picks;
  }
  function chooseWeighted(variants: typeof active[number]): number {
    const total = variants.reduce((acc, v) => acc + v.weight, 0);
    const n = random() * total;
    let running = 0;
    for (let i = 0; i < variants.length; i++) {
      running += variants[i].weight;
      if (n < running) return i;
    }
    return variants.length - 1;
  }

  for (let tokenId = 1; tokenId <= supply; tokenId++) {
    let picks = active.map(chooseWeighted);
    let key = encode(picks);
    // Weighted sampling honours user rarity weights while combinations remain available.
    for (let attempt = 0; used.has(key) && attempt < 24; attempt++) {
      picks = active.map(chooseWeighted);
      key = encode(picks);
    }
    // Saturated distributions need a deterministic completeness fallback.
    // This guarantees uniqueness even when capacity equals supply.
    while (used.has(key)) {
      picks = decode(fallbackCursor);
      key = encode(picks);
      fallbackCursor = (fallbackCursor + 1n) % capacity;
    }
    used.add(key);
    const actualPicks = picks.map((pick, layerIndex) => {
      const originalIndex = active[layerIndex][pick].index;
      counts[layerIndex][originalIndex]++;
      return originalIndex;
    });
    tokens.push({ tokenId, picks: actualPicks, score: 0 });
  }
  for (const token of tokens) {
    token.score = token.picks.reduce((score, originalVariant, layer) => {
      const observed = counts[layer][originalVariant];
      return score + -Math.log2(observed / supply);
    }, 0);
  }
  const ranks = new Array<number>(supply);
  const sorted = [...tokens].sort((a, b) => b.score - a.score || a.tokenId - b.tokenId);
  sorted.forEach((token, i) => { ranks[token.tokenId - 1] = i + 1; });
  return { seed, supply, capacity: capacity.toString(), tokens, counts, ranks };
}

export function tokenMetadata(
  name: string, description: string, layers: TraitLayer[],
  plan: GenerationPlan, tokenIndex: number
) {
  const token = plan.tokens[tokenIndex];
  if (!token) throw Error("Token not in generated plan.");
  const filename = String(token.tokenId).padStart(5, "0");
  return {
    name: name.trim() + " #" + token.tokenId,
    description: description.trim(),
    // Asset URIs intentionally require a real storage CID after image upload.
    image: "ipfs://REPLACE_WITH_REAL_IMAGES_CID/" + filename + ".png",
    attributes: layers.map((layer, i) => ({
      trait_type: layer.name.trim(),
      value: layer.variants[token.picks[i]].name.trim()
    }))
  };
}
