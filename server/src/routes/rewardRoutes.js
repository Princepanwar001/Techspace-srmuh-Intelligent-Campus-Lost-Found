import express from "express";
import User from "../models/User.js";
import RewardEvent from "../models/RewardEvent.js";
import requireAuth from "../middleware/requireAuth.js";
import {
  BADGE_CATALOG,
  REWARD_CONFIG,
  reconcileUserRewards,
} from "../utils/rewardEngine.js";

const router = express.Router();

const ALLOWED_LEADERBOARD_QUERY_KEYS = new Set(["page", "limit"]);
const FORBIDDEN_REWARD_MUTATION_KEYS = new Set([
  "xp",
  "level",
  "badges",
  "points",
  "rank",
  "role",
  "idempotencyKey",
]);

function parseStrictPositiveInt(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    return null;
  }
  const num = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

// Public Leaderboard with validated pagination and minimal public fields
router.get("/leaderboard", async (req, res) => {
  try {
    for (const [key, val] of Object.entries(req.query)) {
      if (!ALLOWED_LEADERBOARD_QUERY_KEYS.has(key) || typeof val !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter",
        });
      }
    }

    let page = 1;
    if (req.query.page !== undefined && req.query.page.trim() !== "") {
      const parsedPage = parseStrictPositiveInt(req.query.page);
      if (!parsedPage || parsedPage > 10000) {
        return res.status(400).json({
          success: false,
          message: "Page must be a positive integer",
        });
      }
      page = parsedPage;
    }

    let limit = 10;
    if (req.query.limit !== undefined && req.query.limit.trim() !== "") {
      const parsedLimit = parseStrictPositiveInt(req.query.limit);
      if (!parsedLimit || parsedLimit > 50) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a positive integer between 1 and 50",
        });
      }
      limit = parsedLimit;
    }

    const filter = {
      leaderboardOptOut: { $ne: true },
      xp: { $gt: 0 },
    };

    const skip = (page - 1) * limit;

    const [totalUsers, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("_id name xp level badges createdAt")
        .sort({ xp: -1, level: -1, createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalUsers / limit));

    const leaderboard = users.map((u, idx) => {
      const safeBadges = Array.isArray(u.badges)
        ? u.badges.map((b) => ({
            code: b.code,
            name: b.name,
            icon: b.icon || "★",
          }))
        : [];

      return {
        rank: skip + idx + 1,
        userId: u._id,
        displayName: u.name,
        xp: u.xp || 0,
        level: u.level || 1,
        badgeCount: safeBadges.length,
        badges: safeBadges,
      };
    });

    return res.json({
      success: true,
      count: leaderboard.length,
      leaderboard,
      pagination: {
        totalUsers,
        currentPage: page,
        pageSize: limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1 && totalUsers > 0,
      },
    });
  } catch (error) {
    console.error("Fetch leaderboard error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load leaderboard",
    });
  }
});

// Authenticated user's XP, level progression, earned badges, and recent reward ledger
router.get("/me", requireAuth, async (req, res) => {
  try {
    if (Object.keys(req.query || {}).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameter",
      });
    }

    const [reconciled, historyDocs] = await Promise.all([
      reconcileUserRewards(req.user._id),
      RewardEvent.find({ user: req.user._id })
        .select("_id eventType points reason item claim createdAt")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    if (!reconciled || !reconciled.user) {
      return res.status(404).json({
        success: false,
        message: "User reward profile not found",
      });
    }

    const earnedByCode = new Map(
      (reconciled.badges || []).map((b) => [b.code, b])
    );

    const badgeCatalog = BADGE_CATALOG.map((catalogBadge) => {
      const earnedEntry = earnedByCode.get(catalogBadge.code);
      return {
        code: catalogBadge.code,
        name: catalogBadge.name,
        description: catalogBadge.description,
        icon: catalogBadge.icon,
        earned: Boolean(earnedEntry),
        awardedAt: earnedEntry?.awardedAt || null,
      };
    });

    return res.json({
      success: true,
      profile: {
        userId: reconciled.user._id,
        displayName: reconciled.user.name,
        xp: reconciled.progress.xp,
        level: reconciled.progress.level,
        progress: reconciled.progress,
        leaderboardOptOut: Boolean(reconciled.user.leaderboardOptOut),
        earnedBadges: reconciled.badges,
        badgeCatalog,
      },
      history: historyDocs,
      rules: {
        xpPerLevel: REWARD_CONFIG.XP_PER_LEVEL,
        maxDailyReportRewards: REWARD_CONFIG.MAX_DAILY_REPORT_REWARDS,
        points: REWARD_CONFIG.POINTS,
      },
    });
  } catch (error) {
    console.error("Fetch my rewards error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load your reward profile",
    });
  }
});

// Update leaderboard visibility preference (never allows editing XP, level, or badges)
router.patch("/preferences", requireAuth, async (req, res) => {
  try {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    for (const key of Object.keys(body)) {
      if (FORBIDDEN_REWARD_MUTATION_KEYS.has(key)) {
        return res.status(403).json({
          success: false,
          message:
            "XP, levels, and badges are server-authoritative and cannot be modified by clients",
        });
      }
      if (key !== "leaderboardOptOut") {
        return res.status(400).json({
          success: false,
          message: "Invalid preference field",
        });
      }
    }

    if (typeof body.leaderboardOptOut !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "leaderboardOptOut must be a boolean",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { leaderboardOptOut: body.leaderboardOptOut } },
      { returnDocument: "after" }
    ).select("_id name xp level leaderboardOptOut");

    return res.json({
      success: true,
      message: body.leaderboardOptOut
        ? "You have opted out of the public leaderboard"
        : "You are now visible on the public leaderboard",
      leaderboardOptOut: Boolean(updatedUser?.leaderboardOptOut),
    });
  } catch (error) {
    console.error("Update reward preferences error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not update leaderboard preferences",
    });
  }
});

// Explicitly block any direct client attempts to POST/PATCH/PUT/DELETE rewards or XP
router.all(["/", "/me", "/award", "/badges"], requireAuth, (req, res) => {
  return res.status(403).json({
    success: false,
    message:
      "Rewards, XP, and badges are server-authoritative and cannot be modified directly",
  });
});

export default router;
