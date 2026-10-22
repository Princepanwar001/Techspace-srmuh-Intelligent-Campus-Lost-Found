import mongoose from "mongoose";
import User from "../models/User.js";
import Item from "../models/Item.js";
import RewardEvent from "../models/RewardEvent.js";

// Central, server-authoritative XP & progression configuration
export const REWARD_CONFIG = Object.freeze({
  XP_PER_LEVEL: 100,
  MAX_DAILY_REPORT_REWARDS: 5,
  MIN_REWARDABLE_TITLE_LENGTH: 3,
  MIN_REWARDABLE_DESCRIPTION_LENGTH: 5,
  POINTS: Object.freeze({
    REPORT_CREATED_LOST: 10,
    REPORT_CREATED_FOUND: 15,
    VERIFIED_RETURN_FINDER: 50,
    VERIFIED_RETURN_CLAIMANT: 15,
  }),
});

export const BADGE_CATALOG = Object.freeze([
  {
    code: "FIRST_VALID_REPORT",
    name: "First Valid Report",
    description:
      "Submitted your first verified lost or found report to help the campus community.",
    icon: "✦",
  },
  {
    code: "HELPFUL_FINDER",
    name: "Helpful Finder",
    description:
      "Reported a found item on campus so its rightful owner can locate it.",
    icon: "⌖",
  },
  {
    code: "SUCCESSFUL_RETURN",
    name: "Successful Return",
    description:
      "Helped complete a verified item return to its rightful campus owner.",
    icon: "★",
  },
  {
    code: "COMMUNITY_HELPER",
    name: "Community Helper",
    description:
      "Earned at least 100 XP or completed multiple verified campus contributions.",
    icon: "♛",
  },
]);

export function computeLevelProgress(rawXp = 0) {
  const xp = Math.max(0, Math.floor(Number(rawXp) || 0));
  const xpPerLevel = REWARD_CONFIG.XP_PER_LEVEL;
  const level = Math.floor(xp / xpPerLevel) + 1;
  const currentLevelFloorXp = (level - 1) * xpPerLevel;
  const nextLevelXp = level * xpPerLevel;
  const xpIntoLevel = xp - currentLevelFloorXp;
  const xpNeededForNextLevel = nextLevelXp - xp;
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((xpIntoLevel / xpPerLevel) * 100))
  );

  return {
    xp,
    level,
    xpPerLevel,
    currentLevelFloorXp,
    nextLevelXp,
    xpIntoLevel,
    xpNeededForNextLevel,
    progressPercent,
  };
}

// Reconcile a user's XP total, level, and earned badges directly from
// server-side database records (RewardEvent + unmoderated Item counts).
// Acts as a deterministic, idempotent recovery strategy without requiring
// multi-document replica-set transactions.
export async function reconcileUserRewards(userId) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return null;
  }

  const userObjectId = new mongoose.Types.ObjectId(userId.toString());

  const [userDoc, events, unmoderatedCounts] = await Promise.all([
    User.findById(userObjectId),
    RewardEvent.find({ user: userObjectId }).lean(),
    Item.aggregate([
      {
        $match: {
          reportedBy: userObjectId,
          moderated: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  if (!userDoc) {
    return null;
  }

  const totalXp = events.reduce(
    (sum, ev) => sum + (Number(ev.points) || 0),
    0
  );
  const progress = computeLevelProgress(totalXp);

  let unmoderatedLostCount = 0;
  let unmoderatedFoundCount = 0;
  for (const row of unmoderatedCounts) {
    if (row._id === "LOST") unmoderatedLostCount = row.count;
    if (row._id === "FOUND") unmoderatedFoundCount = row.count;
  }
  const totalUnmoderatedReports =
    unmoderatedLostCount + unmoderatedFoundCount;

  const validReportEvents = events.filter(
    (ev) =>
      ev.eventType === "REPORT_CREATED_LOST" ||
      ev.eventType === "REPORT_CREATED_FOUND"
  ).length;
  const foundReportEvents = events.filter(
    (ev) => ev.eventType === "REPORT_CREATED_FOUND"
  ).length;
  const verifiedReturnFinderEvents = events.filter(
    (ev) => ev.eventType === "VERIFIED_RETURN_FINDER"
  ).length;
  const verifiedReturnClaimantEvents = events.filter(
    (ev) => ev.eventType === "VERIFIED_RETURN_CLAIMANT"
  ).length;
  const totalVerifiedReturns =
    verifiedReturnFinderEvents + verifiedReturnClaimantEvents;

  const eligibleBadgeCodes = new Set();

  if (totalUnmoderatedReports >= 1 && validReportEvents >= 1) {
    eligibleBadgeCodes.add("FIRST_VALID_REPORT");
  }
  if (unmoderatedFoundCount >= 1 && foundReportEvents >= 1) {
    eligibleBadgeCodes.add("HELPFUL_FINDER");
  }
  if (totalVerifiedReturns >= 1) {
    eligibleBadgeCodes.add("SUCCESSFUL_RETURN");
  }
  if (
    totalXp >= 100 ||
    verifiedReturnFinderEvents >= 2 ||
    validReportEvents >= 3
  ) {
    eligibleBadgeCodes.add("COMMUNITY_HELPER");
  }

  // Build canonical badge list from eligibleBadgeCodes while preserving existing awardedAt timestamps
  const existingBadgesByCode = new Map();
  for (const b of userDoc.badges || []) {
    if (b?.code && !existingBadgesByCode.has(b.code)) {
      existingBadgesByCode.set(b.code, b);
    }
  }

  const now = new Date();
  const mergedBadges = [];
  for (const catalogBadge of BADGE_CATALOG) {
    if (eligibleBadgeCodes.has(catalogBadge.code)) {
      const prev = existingBadgesByCode.get(catalogBadge.code);
      mergedBadges.push({
        code: catalogBadge.code,
        name: catalogBadge.name,
        description: catalogBadge.description,
        icon: catalogBadge.icon,
        awardedAt: prev?.awardedAt || now,
      });
    }
  }

  const updatedUser = await User.findByIdAndUpdate(
    userObjectId,
    {
      $set: {
        xp: progress.xp,
        level: progress.level,
        badges: mergedBadges,
      },
    },
    { returnDocument: "after" }
  );

  return {
    user: updatedUser,
    progress,
    badges: mergedBadges,
  };
}

// Record a single reward event idempotently using a unique idempotencyKey
// and immediately reconcile the user's XP, level, and badges.
export async function recordRewardEvent({
  userId,
  eventType,
  points,
  reason,
  idempotencyKey,
  itemId = null,
  claimId = null,
}) {
  if (!userId || !mongoose.isValidObjectId(userId) || !idempotencyKey) {
    return { awarded: false, reason: "Invalid reward parameters" };
  }

  let createdNew = false;
  let eventDoc = null;

  try {
    eventDoc = await RewardEvent.create({
      user: userId,
      eventType,
      points,
      reason,
      idempotencyKey,
      item: itemId && mongoose.isValidObjectId(itemId) ? itemId : null,
      claim: claimId && mongoose.isValidObjectId(claimId) ? claimId : null,
    });
    createdNew = true;
  } catch (error) {
    // Duplicate idempotencyKey means this exact event was already rewarded
    if (error.code === 11000) {
      eventDoc = await RewardEvent.findOne({ idempotencyKey });
      createdNew = false;
    } else {
      throw error;
    }
  }

  const reconciled = await reconcileUserRewards(userId);

  return {
    awarded: createdNew,
    pointsAwarded: createdNew ? points : 0,
    event: eventDoc,
    xp: reconciled?.progress?.xp ?? 0,
    level: reconciled?.progress?.level ?? 1,
    badges: reconciled?.badges ?? [],
  };
}

// Award XP for creating a valid LOST or FOUND report, subject to content
// validation and the daily anti-spam cap.
export async function awardReportCreationXp({ userId, item }) {
  if (!userId || !item || !item._id) {
    return { awarded: false, pointsAwarded: 0 };
  }

  if (item.moderated === true) {
    return { awarded: false, pointsAwarded: 0 };
  }

  const title = typeof item.title === "string" ? item.title.trim() : "";
  const description =
    typeof item.description === "string" ? item.description.trim() : "";

  if (
    title.length < REWARD_CONFIG.MIN_REWARDABLE_TITLE_LENGTH ||
    description.length < REWARD_CONFIG.MIN_REWARDABLE_DESCRIPTION_LENGTH
  ) {
    return { awarded: false, pointsAwarded: 0 };
  }

  // Anti-spam policy: cap daily report creation rewards per user
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  const todayReportRewardsCount = await RewardEvent.countDocuments({
    user: userId,
    eventType: { $in: ["REPORT_CREATED_LOST", "REPORT_CREATED_FOUND"] },
    createdAt: { $gte: startOfUtcDay },
  });

  if (todayReportRewardsCount >= REWARD_CONFIG.MAX_DAILY_REPORT_REWARDS) {
    const reconciled = await reconcileUserRewards(userId);
    return {
      awarded: false,
      pointsAwarded: 0,
      dailyCapReached: true,
      xp: reconciled?.progress?.xp ?? 0,
      level: reconciled?.progress?.level ?? 1,
    };
  }

  const isFound = item.type === "FOUND";
  const eventType = isFound ? "REPORT_CREATED_FOUND" : "REPORT_CREATED_LOST";
  const points = isFound
    ? REWARD_CONFIG.POINTS.REPORT_CREATED_FOUND
    : REWARD_CONFIG.POINTS.REPORT_CREATED_LOST;
  const reason = isFound
    ? `Reported found item: "${title.slice(0, 60)}"`
    : `Reported lost item: "${title.slice(0, 60)}"`;

  const idempotencyKey = `report_create:${item._id.toString()}:${userId.toString()}`;

  return recordRewardEvent({
    userId,
    eventType,
    points,
    reason,
    idempotencyKey,
    itemId: item._id,
  });
}

// Award XP when a claim on a FOUND item is verified and APPROVED (item marked RETURNED).
// Keyed by item._id so an item return can never award XP more than once even if retried
// or if an admin changes item status back and forth.
export async function awardVerifiedReturnXp({ item, claim }) {
  if (
    !item ||
    !item._id ||
    item.moderated === true ||
    item.type !== "FOUND" ||
    !claim ||
    !claim._id ||
    claim.status !== "APPROVED"
  ) {
    return { finderReward: null, claimantReward: null };
  }

  const itemIdStr = item._id.toString();
  const finderIdStr = item.reportedBy
    ? (item.reportedBy._id || item.reportedBy).toString()
    : "";
  const claimantIdStr = claim.claimant
    ? (claim.claimant._id || claim.claimant).toString()
    : "";

  // Never reward self-claims
  if (finderIdStr && claimantIdStr && finderIdStr === claimantIdStr) {
    return { finderReward: null, claimantReward: null };
  }

  const titleSnippet =
    typeof item.title === "string" ? item.title.trim().slice(0, 60) : "item";

  let finderReward = null;
  let claimantReward = null;

  if (finderIdStr && mongoose.isValidObjectId(finderIdStr)) {
    finderReward = await recordRewardEvent({
      userId: finderIdStr,
      eventType: "VERIFIED_RETURN_FINDER",
      points: REWARD_CONFIG.POINTS.VERIFIED_RETURN_FINDER,
      reason: `Verified item return completed for found report: "${titleSnippet}"`,
      idempotencyKey: `verified_return_finder:${itemIdStr}`,
      itemId: item._id,
      claimId: claim._id,
    });
  }

  if (claimantIdStr && mongoose.isValidObjectId(claimantIdStr)) {
    claimantReward = await recordRewardEvent({
      userId: claimantIdStr,
      eventType: "VERIFIED_RETURN_CLAIMANT",
      points: REWARD_CONFIG.POINTS.VERIFIED_RETURN_CLAIMANT,
      reason: `Verified ownership claim completed for: "${titleSnippet}"`,
      idempotencyKey: `verified_return_claimant:${itemIdStr}`,
      itemId: item._id,
      claimId: claim._id,
    });
  }

  return { finderReward, claimantReward };
}

// If an admin moderates/removes an inappropriate report, revoke any creation XP
// earned from that report and reconcile the reporter's XP & level.
export async function revokeModeratedReportXp(item) {
  if (!item || !item._id) return;

  await RewardEvent.deleteMany({
    item: item._id,
    eventType: { $in: ["REPORT_CREATED_LOST", "REPORT_CREATED_FOUND"] },
  });

  if (item.reportedBy && mongoose.isValidObjectId(item.reportedBy)) {
    await reconcileUserRewards(item.reportedBy);
  }
}
