import express from "express";
import mongoose from "mongoose";
import Item from "../models/Item.js";
import User from "../models/User.js";
import Claim from "../models/Claim.js";
import RewardEvent from "../models/RewardEvent.js";
import requireAuth from "../middleware/requireAuth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { revokeModeratedReportXp } from "../utils/rewardEngine.js";
import {
  notifyClaimReviewed,
  notifyReportModerated,
} from "../utils/notificationService.js";

const router = express.Router();

const ALLOWED_ANALYTICS_QUERY_KEYS = new Set(["recentLimit"]);
const ALLOWED_ADMIN_ITEMS_QUERY_KEYS = new Set([
  "status",
  "includeModerated",
  "limit",
]);

function parseStrictPositiveInt(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    return null;
  }
  const num = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

const ALLOWED_STATUSES = [
  "OPEN",
  "MATCHED",
  "CLAIM_PENDING",
  "RETURNED",
  "CLOSED",
];

// Explicit map of valid status transitions for moderation
const ALLOWED_STATUS_TRANSITIONS = {
  OPEN: ["MATCHED", "CLAIM_PENDING", "RETURNED", "CLOSED"],
  MATCHED: ["OPEN", "CLAIM_PENDING", "RETURNED", "CLOSED"],
  CLAIM_PENDING: ["OPEN", "MATCHED", "RETURNED", "CLOSED"],
  RETURNED: ["CLOSED", "OPEN"],
  CLOSED: ["OPEN"],
};

function logAdminAction({ adminUser, action, targetItemId, details }) {
  const entry = {
    timestamp: new Date().toISOString(),
    adminId: adminUser._id.toString(),
    adminEmail: adminUser.email,
    action,
    targetItemId: targetItemId.toString(),
    details,
  };
  console.info("[ADMIN_AUDIT]", JSON.stringify(entry));
}

// Protect all admin routes with authentication + admin role verification
router.use(requireAuth, requireAdmin);

// Server-derived campus analytics & moderation overview (admin only)
// Never exposes passwordHash, private claim proofDescription, or private reviewNote.
router.get("/analytics", async (req, res) => {
  try {
    for (const [key, val] of Object.entries(req.query)) {
      if (!ALLOWED_ANALYTICS_QUERY_KEYS.has(key) || typeof val !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter",
        });
      }
    }

    let recentLimit = 6;
    if (
      req.query.recentLimit !== undefined &&
      req.query.recentLimit.trim() !== ""
    ) {
      const parsedLimit = parseStrictPositiveInt(req.query.recentLimit);
      if (!parsedLimit || parsedLimit > 25) {
        return res.status(400).json({
          success: false,
          message: "recentLimit must be a positive integer between 1 and 25",
        });
      }
      recentLimit = parsedLimit;
    }

    const [
      userCountsByRole,
      itemFacetResult,
      claimStatusAgg,
      xpAggResult,
      recentReportsRaw,
      recentClaimsRaw,
      recentModerationRaw,
    ] = await Promise.all([
      User.aggregate([
        {
          $group: {
            _id: "$role",
            count: { $sum: 1 },
          },
        },
      ]),
      Item.aggregate([
        {
          $facet: {
            byModeration: [
              {
                $group: {
                  _id: { $eq: ["$moderated", true] },
                  count: { $sum: 1 },
                },
              },
            ],
            activeByType: [
              { $match: { moderated: { $ne: true } } },
              {
                $group: {
                  _id: "$type",
                  count: { $sum: 1 },
                },
              },
            ],
            activeByStatus: [
              { $match: { moderated: { $ne: true } } },
              {
                $group: {
                  _id: "$status",
                  count: { $sum: 1 },
                },
              },
            ],
            activeByCategory: [
              { $match: { moderated: { $ne: true } } },
              {
                $group: {
                  _id: "$category",
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1, _id: 1 } },
            ],
          },
        },
      ]),
      Claim.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      RewardEvent.aggregate([
        {
          $group: {
            _id: null,
            totalXp: { $sum: "$points" },
            eventCount: { $sum: 1 },
          },
        },
      ]),
      Item.find({})
        .select(
          "_id title category type location status moderated createdAt reportedBy"
        )
        .populate("reportedBy", "_id name role")
        .sort({ createdAt: -1 })
        .limit(recentLimit)
        .lean(),
      Claim.find({})
        .select("_id item claimant status reviewedBy reviewedAt createdAt")
        .populate("item", "_id title category type status")
        .populate("claimant", "_id name")
        .populate("reviewedBy", "_id name role")
        .sort({ createdAt: -1 })
        .limit(recentLimit)
        .lean(),
      Item.find({ moderated: true })
        .select(
          "_id title category type location moderatedAt moderationReason moderatedBy"
        )
        .populate("moderatedBy", "_id name role")
        .sort({ moderatedAt: -1, updatedAt: -1 })
        .limit(recentLimit)
        .lean(),
    ]);

    let studentUsers = 0;
    let adminUsers = 0;
    for (const row of userCountsByRole) {
      if (row._id === "admin") adminUsers += row.count;
      else studentUsers += row.count;
    }
    const totalUsers = studentUsers + adminUsers;

    const itemFacet = itemFacetResult[0] || {};
    let moderatedReports = 0;
    let activeReports = 0;
    for (const row of itemFacet.byModeration || []) {
      if (row._id === true) moderatedReports = row.count;
      else activeReports = row.count;
    }
    const totalReports = activeReports + moderatedReports;

    const reportsByType = { LOST: 0, FOUND: 0 };
    for (const row of itemFacet.activeByType || []) {
      if (row._id === "LOST" || row._id === "FOUND") {
        reportsByType[row._id] = row.count;
      }
    }

    const reportsByStatus = {
      OPEN: 0,
      MATCHED: 0,
      CLAIM_PENDING: 0,
      RETURNED: 0,
      CLOSED: 0,
    };
    for (const row of itemFacet.activeByStatus || []) {
      if (Object.prototype.hasOwnProperty.call(reportsByStatus, row._id)) {
        reportsByStatus[row._id] = row.count;
      }
    }

    const reportsByCategory = (itemFacet.activeByCategory || []).map((row) => ({
      category: row._id,
      count: row.count,
    }));

    const claimsByStatus = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    for (const row of claimStatusAgg) {
      if (Object.prototype.hasOwnProperty.call(claimsByStatus, row._id)) {
        claimsByStatus[row._id] = row.count;
      }
    }
    const totalClaims =
      claimsByStatus.PENDING +
      claimsByStatus.APPROVED +
      claimsByStatus.REJECTED;

    const xpSummary = xpAggResult[0] || { totalXp: 0, eventCount: 0 };

    const recentReports = recentReportsRaw.map((r) => ({
      _id: r._id,
      title: r.title,
      category: r.category,
      type: r.type,
      location: r.location,
      status: r.status,
      moderated: Boolean(r.moderated),
      createdAt: r.createdAt,
      reporterName: r.reportedBy?.name || "Community Member",
    }));

    // Explicitly exclude proofDescription and private reviewNote from analytics summaries
    const recentClaims = recentClaimsRaw.map((c) => ({
      _id: c._id,
      status: c.status,
      createdAt: c.createdAt,
      reviewedAt: c.reviewedAt || null,
      itemTitle: c.item?.title || "Report",
      itemType: c.item?.type || "FOUND",
      itemStatus: c.item?.status || "OPEN",
      claimantName: c.claimant?.name || "Student",
      reviewerName: c.reviewedBy?.name || null,
    }));

    const recentModeration = recentModerationRaw.map((m) => ({
      _id: m._id,
      title: m.title,
      category: m.category,
      type: m.type,
      moderatedAt: m.moderatedAt,
      moderationReason: m.moderationReason || "",
      moderatorName: m.moderatedBy?.name || "Admin",
    }));

    return res.json({
      success: true,
      totals: {
        totalUsers,
        studentUsers,
        adminUsers,
        totalReports,
        activeReports,
        lostReports: reportsByType.LOST,
        foundReports: reportsByType.FOUND,
        openReports: reportsByStatus.OPEN,
        claimPendingReports: reportsByStatus.CLAIM_PENDING,
        completedReturns: reportsByStatus.RETURNED,
        closedReports: reportsByStatus.CLOSED,
        moderatedReports,
        totalClaims,
        pendingClaims: claimsByStatus.PENDING,
        approvedClaims: claimsByStatus.APPROVED,
        rejectedClaims: claimsByStatus.REJECTED,
        totalXpAwarded: xpSummary.totalXp || 0,
        totalRewardEvents: xpSummary.eventCount || 0,
      },
      breakdowns: {
        reportsByType,
        reportsByStatus,
        reportsByCategory,
        claimsByStatus,
      },
      recentActivity: {
        recentReports,
        recentClaims,
        recentModeration,
      },
    });
  } catch (error) {
    console.error("Admin analytics error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load admin analytics",
    });
  }
});

// List reports for moderation
router.get("/items", async (req, res) => {
  try {
    for (const [key, val] of Object.entries(req.query)) {
      if (
        !ALLOWED_ADMIN_ITEMS_QUERY_KEYS.has(key) ||
        typeof val !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter",
        });
      }
    }

    const { status, includeModerated } = req.query;
    let limit = 100;
    if (req.query.limit !== undefined && req.query.limit.trim() !== "") {
      const parsedLimit = parseStrictPositiveInt(req.query.limit);
      if (!parsedLimit || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a positive integer between 1 and 100",
        });
      }
      limit = parsedLimit;
    }

    const filter = {};

    if (status !== undefined && status !== "") {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status filter",
        });
      }
      filter.status = status;
    }

    if (includeModerated !== undefined && includeModerated !== "") {
      if (includeModerated !== "true" && includeModerated !== "false") {
        return res.status(400).json({
          success: false,
          message: "includeModerated must be 'true' or 'false'",
        });
      }
      if (includeModerated === "false") {
        filter.moderated = { $ne: true };
      }
    }

    const items = await Item.find(filter)
      .populate("reportedBy", "_id name email role")
      .populate("moderatedBy", "_id name email")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("Admin fetch items error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not fetch reports for moderation",
    });
  }
});

// View single report details for moderation
router.get("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    const item = await Item.findById(id)
      .populate("reportedBy", "_id name email role")
      .populate("moderatedBy", "_id name email");

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    console.error("Admin get item error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not fetch report details",
    });
  }
});

// Change a report's status (admin moderation)
router.patch("/items/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status =
      typeof req.body?.status === "string"
        ? req.body.status.trim()
        : "";

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const item = await Item.findById(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const previousStatus = item.status;

    if (previousStatus === status) {
      return res.json({
        success: true,
        message: `Report status is already ${status}`,
        item,
      });
    }

    const allowedNext = ALLOWED_STATUS_TRANSITIONS[previousStatus] || [];
    if (!allowedNext.includes(status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot transition status from ${previousStatus} to ${status}`,
      });
    }

    item.status = status;
    await item.save();

    logAdminAction({
      adminUser: req.user,
      action: "UPDATE_STATUS",
      targetItemId: item._id,
      details: { from: previousStatus, to: status },
    });

    return res.json({
      success: true,
      message: "Report status updated successfully",
      item,
    });
  } catch (error) {
    console.error("Admin update status error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not update report status",
    });
  }
});

// Soft-remove / moderate an inappropriate report (preserves record for auditability)
router.delete("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (
      req.body?.reason !== undefined &&
      typeof req.body.reason !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Moderation reason must be a string",
      });
    }

    const rawReason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    if (rawReason.length > 300) {
      return res.status(400).json({
        success: false,
        message: "Moderation reason must be 300 characters or fewer",
      });
    }

    const item = await Item.findById(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const reason = rawReason || "Removed by moderator";

    item.moderated = true;
    item.moderatedAt = new Date();
    item.moderatedBy = req.user._id;
    item.moderationReason = reason;
    item.status = "CLOSED";

    await item.save();

    try {
      await revokeModeratedReportXp(item);
    } catch (rewardError) {
      console.error("Revoke moderated report XP error:", rewardError.message);
    }

    // Auto-reject any PENDING claims on the moderated item so they are not stranded
    let autoRejectedClaims = 0;
    try {
      const pendingClaimsOnItem = await Claim.find({
        item: item._id,
        status: "PENDING",
      });

      if (pendingClaimsOnItem.length > 0) {
        autoRejectedClaims = pendingClaimsOnItem.length;
        const now = new Date();
        await Claim.updateMany(
          {
            item: item._id,
            status: "PENDING",
          },
          {
            $set: {
              status: "REJECTED",
              reviewedBy: req.user._id,
              reviewedAt: now,
              reviewNote: "Report was removed by moderation",
            },
          }
        );

        for (const pendingClaim of pendingClaimsOnItem) {
          await notifyClaimReviewed({
            item,
            claim: pendingClaim,
            decision: "REJECTED",
          });
        }
      }

      await notifyReportModerated({ item });
    } catch (notifError) {
      console.error("Moderation notification error:", notifError.message);
    }

    logAdminAction({
      adminUser: req.user,
      action: "MODERATE_REMOVE",
      targetItemId: item._id,
      details: { reason },
    });

    return res.json({
      success: true,
      message: "Report removed from public listing",
      item,
      autoRejectedClaims,
    });
  } catch (error) {
    console.error("Admin moderate item error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not moderate report",
    });
  }
});

export default router;
