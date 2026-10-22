// Phase 5A: Rule-based, explainable Lost & Found matching engine.
// Scores candidate items from 0 to 100 using deterministic weighted heuristics:
//   - Title similarity:               0–30 points
//   - Description keyword similarity: 0–25 points
//   - Category match:                 0 or 20 points
//   - Location similarity:            0–15 points
//   - Date proximity:                 0–10 points

export const ELIGIBLE_MATCH_STATUSES = ["OPEN", "MATCHED", "CLAIM_PENDING"];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "around",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "found",
  "from",
  "has",
  "have",
  "i",
  "in",
  "inside",
  "is",
  "it",
  "item",
  "its",
  "lost",
  "missing",
  "my",
  "near",
  "of",
  "on",
  "or",
  "outside",
  "please",
  "report",
  "reported",
  "some",
  "someone",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

const LOCATION_STOP_WORDS = new Set([
  "at",
  "building",
  "by",
  "campus",
  "floor",
  "in",
  "near",
  "next",
  "of",
  "on",
  "outside",
  "room",
  "the",
  "to",
]);

export function normalizeText(input) {
  if (typeof input !== "string") return "";
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTokens(input, stopWords = STOP_WORDS) {
  const normalized = normalizeText(input);
  if (!normalized) return [];

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 2 && !stopWords.has(token));

  return Array.from(new Set(tokens));
}

function computeDiceSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return { similarity: 0, shared: [] };
  }

  const setB = new Set(tokensB);
  const shared = tokensA.filter((t) => setB.has(t));

  if (shared.length === 0) {
    return { similarity: 0, shared: [] };
  }

  const similarity = (2 * shared.length) / (tokensA.length + tokensB.length);
  return {
    similarity: Math.min(1, similarity),
    shared,
  };
}

export function isItemEligibleForMatching(item) {
  if (!item || typeof item !== "object") return false;
  if (item.moderated === true) return false;
  if (item.type !== "LOST" && item.type !== "FOUND") return false;
  if (!ELIGIBLE_MATCH_STATUSES.includes(item.status)) return false;
  return true;
}

export function scoreItemPair(sourceItem, candidateItem) {
  if (
    !isItemEligibleForMatching(sourceItem) ||
    !isItemEligibleForMatching(candidateItem)
  ) {
    return null;
  }

  const sourceId = sourceItem._id ? sourceItem._id.toString() : "";
  const candidateId = candidateItem._id ? candidateItem._id.toString() : "";

  // Never match an item with itself
  if (sourceId && candidateId && sourceId === candidateId) {
    return null;
  }

  // Only match LOST with FOUND and vice versa
  if (sourceItem.type === candidateItem.type) {
    return null;
  }

  const reasons = [];
  const breakdown = {
    title: 0,
    description: 0,
    category: 0,
    location: 0,
    date: 0,
  };

  // 1. Category Match (20 points)
  if (
    typeof sourceItem.category === "string" &&
    sourceItem.category.length > 0 &&
    sourceItem.category === candidateItem.category
  ) {
    breakdown.category = 20;
    reasons.push(`Same category (${sourceItem.category})`);
  }

  // 2. Title Similarity (0–30 points)
  const normTitleA = normalizeText(sourceItem.title);
  const normTitleB = normalizeText(candidateItem.title);
  const titleTokensA = extractTokens(sourceItem.title, STOP_WORDS);
  const titleTokensB = extractTokens(candidateItem.title, STOP_WORDS);

  if (normTitleA && normTitleA === normTitleB) {
    breakdown.title = 30;
    reasons.push("Exact title match");
  } else {
    const { similarity, shared } = computeDiceSimilarity(
      titleTokensA,
      titleTokensB
    );
    if (shared.length > 0) {
      breakdown.title = Math.min(30, Math.max(1, Math.round(30 * similarity)));
      reasons.push(
        `Similar title keywords (${shared.slice(0, 3).join(", ")})`
      );
    }
  }

  // 3. Description Keyword Similarity (0–25 points)
  const descTokensA = extractTokens(sourceItem.description, STOP_WORDS);
  const descTokensB = extractTokens(candidateItem.description, STOP_WORDS);
  const { similarity: descSim, shared: descShared } = computeDiceSimilarity(
    descTokensA,
    descTokensB
  );

  if (descShared.length > 0) {
    breakdown.description = Math.min(
      25,
      Math.max(1, Math.round(25 * descSim))
    );
    reasons.push(
      `Similar description keywords (${descShared.slice(0, 4).join(", ")})`
    );
  }

  // 4. Location Similarity (0–15 points)
  const normLocA = normalizeText(sourceItem.location);
  const normLocB = normalizeText(candidateItem.location);
  const locTokensA = extractTokens(sourceItem.location, LOCATION_STOP_WORDS);
  const locTokensB = extractTokens(candidateItem.location, LOCATION_STOP_WORDS);

  if (normLocA && normLocA === normLocB) {
    breakdown.location = 15;
    reasons.push(`Same location (${sourceItem.location.trim()})`);
  } else {
    const { similarity: locSim, shared: locShared } = computeDiceSimilarity(
      locTokensA,
      locTokensB
    );
    if (locShared.length > 0) {
      breakdown.location = Math.min(
        14,
        Math.max(5, Math.round(15 * locSim))
      );
      reasons.push(
        `Similar location (${locShared.slice(0, 3).join(", ")})`
      );
    }
  }

  // 5. Date Proximity (0–10 points)
  let dateDiffMs = Number.POSITIVE_INFINITY;
  if (sourceItem.itemDate && candidateItem.itemDate) {
    const timeA = new Date(sourceItem.itemDate).getTime();
    const timeB = new Date(candidateItem.itemDate).getTime();
    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
      dateDiffMs = Math.abs(timeA - timeB);
      const diffDays = dateDiffMs / (1000 * 60 * 60 * 24);

      if (diffDays <= 1) {
        breakdown.date = 10;
        reasons.push("Dates are within 1 day");
      } else if (diffDays <= 3) {
        breakdown.date = 8;
        reasons.push("Dates are close (within 3 days)");
      } else if (diffDays <= 7) {
        breakdown.date = 6;
        reasons.push("Dates are within 1 week");
      } else if (diffDays <= 14) {
        breakdown.date = 3;
        reasons.push("Dates are within 2 weeks");
      } else if (diffDays <= 30) {
        breakdown.date = 1;
        reasons.push("Dates are within 30 days");
      }
    }
  }

  const rawTotal =
    breakdown.title +
    breakdown.description +
    breakdown.category +
    breakdown.location +
    breakdown.date;

  const matchScore = Math.max(0, Math.min(100, Math.round(rawTotal)));

  return {
    matchScore,
    scoreBreakdown: breakdown,
    reasons,
    dateDiffMs,
  };
}

export function sanitizeMatchedItem(item) {
  const plain =
    (typeof item?.toObject === "function" ? item.toObject() : item) || {};
  return {
    _id: plain._id ?? null,
    title: plain.title ?? "",
    description: plain.description ?? "",
    category: plain.category ?? "",
    type: plain.type ?? "",
    location: plain.location ?? "",
    itemDate: plain.itemDate ?? null,
    status: plain.status ?? "",
    reportedBy: plain.reportedBy ?? null,
    createdAt: plain.createdAt ?? null,
    updatedAt: plain.updatedAt ?? null,
  };
}

export function findMatchesForItem(
  sourceItem,
  candidateItems,
  { limit = 5, minScore = 15 } = {}
) {
  if (!isItemEligibleForMatching(sourceItem) || !Array.isArray(candidateItems)) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const safeMinScore = Math.max(1, Math.min(100, Number(minScore) || 15));

  const scored = [];

  for (const candidate of candidateItems) {
    const evaluation = scoreItemPair(sourceItem, candidate);
    if (!evaluation || evaluation.matchScore < safeMinScore) {
      continue;
    }

    scored.push({
      item: sanitizeMatchedItem(candidate),
      matchScore: evaluation.matchScore,
      scoreBreakdown: evaluation.scoreBreakdown,
      reasons: evaluation.reasons,
      _dateDiffMs: evaluation.dateDiffMs,
    });
  }

  // Deterministic ordering:
  // 1. Highest matchScore first
  // 2. Closest itemDate (smallest _dateDiffMs)
  // 3. Newest createdAt
  // 4. Deterministic _id tie-breaker
  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    if (a._dateDiffMs !== b._dateDiffMs) {
      return a._dateDiffMs - b._dateDiffMs;
    }
    const createdA = a.item.createdAt ? new Date(a.item.createdAt).getTime() : 0;
    const createdB = b.item.createdAt ? new Date(b.item.createdAt).getTime() : 0;
    if (createdB !== createdA) {
      return createdB - createdA;
    }
    return String(b.item._id).localeCompare(String(a.item._id));
  });

  return scored.slice(0, safeLimit).map(({ _dateDiffMs, ...rest }) => rest);
}
