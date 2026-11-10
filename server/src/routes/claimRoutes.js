import express from "express";
import mongoose from "mongoose";
import Claim from "../models/Claim.js";
import Item from "../models/Item.js";
import requireAuth from "../middleware/requireAuth.js";
import { awardVerifiedReturnXp } from "../utils/rewardEngine.js";
import {
  notifyClaimReviewed,
  notifyClaimSubmitted,
  notifyRewardSettlementUpdate,
} from "../utils/notificationService.js";

const router = express.Router();

const ALLOWED_REVIEW_DECISIONS = ["APPROVED", "REJECTED"];

function sanitizePopulatedItemImages(itemDoc, viewer) {
  if (!itemDoc || typeof itemDoc !== "object") return itemDoc;
  const raw =
    typeof itemDoc.toObject === "function" ? itemDoc.toObject() : { ...itemDoc };
  const isAdmin = viewer?.role === "admin";
  const ownerId =
    raw.reportedBy && typeof raw.reportedBy === "object" && raw.reportedBy._id
      ? raw.reportedBy._id.toString()
      : raw.reportedBy
      ? raw.reportedBy.toString()
      : null;
  const isOwner =
    Boolean(viewer?._id) &&
    Boolean(ownerId) &&
    ownerId === viewer._id.toString();
  const canSeePrivate = isAdmin || isOwner;

  if (Array.isArray(raw.images)) {
    raw.images = raw.images
      .filter((img) => img && (canSeePrivate || img.visibility === "PUBLIC"))
      .map((img) => ({
        _id: img._id,
        url: img.url,
        visibility: img.visibility || "PUBLIC",
        mimeType: img.mimeType,
        sizeBytes: img.sizeBytes,
        createdAt: img.createdAt,
      }));
  }
  return raw;
}

function sanitizeClaimForViewer(claimDoc, viewer) {
  if (!claimDoc) return null;
  const raw =
    typeof claimDoc.toObject === "function"
      ? claimDoc.toObject()
      : { ...claimDoc };
  if (raw.item && typeof raw.item === "object") {
    raw.item = sanitizePopulatedItemImages(raw.item, viewer);
  }
  if (raw.linkedLostItem && typeof raw.linkedLostItem === "object") {
    raw.linkedLostItem = sanitizePopulatedItemImages(
      raw.linkedLostItem,
      viewer
    );
  }
  return raw;
}

function logClaimReview({ reviewer, claimId, itemId, decision }) {
  const entry = {
    timestamp: new Date().toISOString(),
    reviewerId: reviewer._id.toString(),
    reviewerRole: reviewer.role,
    claimId: claimId.toString(),
    itemId: itemId.toString(),
    decision,
  };
  console.info("[CLAIM_AUDIT]", JSON.stringify(entry));
}

// Reconcile an item's status with its actual active claims in MongoDB.
// Safe recovery strategy when multi-document transactions are not used or after a partial failure.
async function reconcileItemClaimStatus(itemId) {
  const [approvedCount, pendingCount] = await Promise.all([
    Claim.countDocuments({ item: itemId, status: "APPROVED" }),
    Claim.countDocuments({ item: itemId, status: "PENDING" }),
  ]);

  if (approvedCount > 0) {
    await Item.updateOne(
      {
        _id: itemId,
        moderated: { $ne: true },
        status: { $in: ["OPEN", "CLAIM_PENDING", "RETURNED"] },
      },
      { $set: { status: "RETURNED" } }
    );
    return "RETURNED";
  }

  if (pendingCount > 0) {
    await Item.updateOne(
      {
        _id: itemId,
        moderated: { $ne: true },
        status: { $in: ["OPEN", "CLAIM_PENDING", "RETURNED"] },
      },
      { $set: { status: "CLAIM_PENDING" } }
    );
    return "CLAIM_PENDING";
  }

  await Item.updateOne(
    {
      _id: itemId,
      moderated: { $ne: true },
      status: { $in: ["CLAIM_PENDING", "RETURNED"] },
    },
    { $set: { status: "OPEN" } }
  );
  return "OPEN";
}

// All claim endpoints require authentication
router.use(requireAuth);

// Submit a claim on an eligible FOUND item (or a LOST item with an active reward offer)
router.post("/", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const itemId =
      typeof body.itemId === "string" ? body.itemId.trim() : "";
    const proofDescription =
      typeof body.proofDescription === "string"
        ? body.proofDescription.trim()
        : "";
    const rawLinkedLostItemId =
      body.linkedLostItemId !== undefined && body.linkedLostItemId !== null
        ? String(body.linkedLostItemId).trim()
        : "";

    if (!mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Valid itemId is required",
      });
    }

    if (proofDescription.length < 10 || proofDescription.length > 1000) {
      return res.status(400).json({
        success: false,
        message:
          "Identifying proof description must be between 10 and 1000 characters",
      });
    }

    const item = await Item.findById(itemId);

    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item report not found",
      });
    }

    const isEligibleLostWithReward =
      item.type === "LOST" && item.rewardStatus === "OFFERED";
    if (item.type !== "FOUND" && !isEligibleLostWithReward) {
      return res.status(400).json({
        success: false,
        message:
          "Only FOUND item reports (or LOST item reports with an active reward offer) can be claimed",
      });
    }

    // Legacy Phase 1 items may not have reportedBy; guard safely before comparing
    if (
      item.reportedBy &&
      item.reportedBy.toString() === req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot submit a claim on your own report",
      });
    }

    if (item.status !== "OPEN" && item.status !== "CLAIM_PENDING") {
      return res.status(409).json({
        success: false,
        message: `This report is ${item.status} and is no longer accepting claims`,
      });
    }

    let linkedLostItemDoc = null;
    if (rawLinkedLostItemId !== "") {
      if (item.type !== "FOUND") {
        return res.status(400).json({
          success: false,
          message:
            "linkedLostItemId can only be attached when claiming a FOUND item",
        });
      }
      if (!mongoose.isValidObjectId(rawLinkedLostItemId)) {
        return res.status(400).json({
          success: false,
          message: "linkedLostItemId must be a valid item ID",
        });
      }
      linkedLostItemDoc = await Item.findById(rawLinkedLostItemId);
      if (
        !linkedLostItemDoc ||
        linkedLostItemDoc.moderated === true ||
        linkedLostItemDoc.type !== "LOST"
      ) {
        return res.status(404).json({
          success: false,
          message: "Linked LOST item report not found",
        });
      }
      if (
        !linkedLostItemDoc.reportedBy ||
        linkedLostItemDoc.reportedBy.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You can only link a LOST item report that belongs to your account",
        });
      }
    }

    // Check for an existing active (PENDING or APPROVED) claim by this student
    const existingActive = await Claim.findOne({
      item: item._id,
      claimant: req.user._id,
      status: { $in: ["PENDING", "APPROVED"] },
    });

    if (existingActive) {
      return res.status(409).json({
        success: false,
        message: "You already have an active claim for this item",
      });
    }

    // Ensure no claim has already been approved for this item
    const existingApproved = await Claim.findOne({
      item: item._id,
      status: "APPROVED",
    });

    if (existingApproved) {
      return res.status(409).json({
        success: false,
        message: "A claim has already been approved for this item",
      });
    }

    // Never accept claimant, status, or review fields from client body
    const claim = await Claim.create({
      item: item._id,
      claimant: req.user._id,
      proofDescription,
      status: "PENDING",
      linkedLostItem: linkedLostItemDoc ? linkedLostItemDoc._id : null,
    });

    // Atomically verify the item is still eligible and transition OPEN -> CLAIM_PENDING
    const updatedItem = await Item.findOneAndUpdate(
      {
        _id: item._id,
        type: item.type,
        moderated: { $ne: true },
        status: { $in: ["OPEN", "CLAIM_PENDING"] },
      },
      {
        $set: { status: "CLAIM_PENDING" },
      },
      { returnDocument: "after" }
    );

    if (!updatedItem) {
      // Roll back the newly created claim if the item was concurrently closed/returned/deleted
      await Claim.deleteOne({ _id: claim._id });
      return res.status(409).json({
        success: false,
        message: "This report is no longer accepting claims",
      });
    }

    try {
      await notifyClaimSubmitted({ item: updatedItem, claim });
    } catch (notifError) {
      console.error("Claim submitted notification error:", notifError.message);
    }

    return res.status(201).json({
      success: true,
      message: "Claim submitted successfully",
      claim,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You already have an active claim for this item",
      });
    }

    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid claim details",
      });
    }

    console.error("Create claim error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not submit claim",
    });
  }
});

// Get claims submitted by the logged-in user
router.get("/mine", async (req, res) => {
  try {
    if (Object.keys(req.query).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameter",
      });
    }

    const claims = await Claim.find({ claimant: req.user._id })
      .populate(
        "item",
        "_id title category type location itemDate status reportedBy images rewardAmountPaise rewardCurrency rewardStatus rewardSettledAt rewardSettlement"
      )
      .populate(
        "linkedLostItem",
        "_id title category type location itemDate status reportedBy images rewardAmountPaise rewardCurrency rewardStatus rewardSettledAt rewardSettlement"
      )
      .populate("reviewedBy", "_id name role")
      .sort({ createdAt: -1 });

    const sanitizedClaims = claims.map((c) =>
      sanitizeClaimForViewer(c, req.user)
    );

    return res.json({
      success: true,
      count: sanitizedClaims.length,
      claims: sanitizedClaims,
    });
  } catch (error) {
    console.error("Fetch my claims error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not fetch your claims",
    });
  }
});

// Get claims awaiting review on items owned by the logged-in user (or all claims for admin)
router.get("/received", async (req, res) => {
  try {
    for (const [key, val] of Object.entries(req.query)) {
      if (key !== "scope" || typeof val !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter",
        });
      }
    }

    const rawScope =
      req.query.scope !== undefined ? req.query.scope.trim() : "owned";
    if (rawScope !== "" && rawScope !== "owned" && rawScope !== "all") {
      return res.status(400).json({
        success: false,
        message: "scope must be 'owned' or 'all'",
      });
    }

    if (rawScope === "all" && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required for all-campus claim scope",
      });
    }

    const isAdminAll =
      req.user.role === "admin" && rawScope === "all";

    let itemFilter = {};
    if (!isAdminAll) {
      const ownershipCondition =
        req.user.role === "admin"
          ? {
              $or: [
                { reportedBy: req.user._id },
                { reportedBy: { $exists: false } },
                { reportedBy: null },
              ],
            }
          : { reportedBy: req.user._id };

      const ownedItems = await Item.find({
        ...ownershipCondition,
        moderated: { $ne: true },
      }).select("_id");
      const ownedIds = ownedItems.map((i) => i._id);
      itemFilter = { item: { $in: ownedIds } };
    }

    const claims = await Claim.find(itemFilter)
      .populate(
        "item",
        "_id title category type location itemDate status reportedBy moderated images rewardAmountPaise rewardCurrency rewardStatus rewardSettledAt rewardSettlement"
      )
      .populate(
        "linkedLostItem",
        "_id title category type location itemDate status reportedBy moderated images rewardAmountPaise rewardCurrency rewardStatus rewardSettledAt rewardSettlement"
      )
      .populate("claimant", "_id name email")
      .populate("reviewedBy", "_id name role")
      .sort({ createdAt: -1 });

    const sanitizedClaims = claims.map((c) =>
      sanitizeClaimForViewer(c, req.user)
    );

    return res.json({
      success: true,
      count: sanitizedClaims.length,
      claims: sanitizedClaims,
    });
  } catch (error) {
    console.error("Fetch received claims error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not fetch claims for review",
    });
  }
});

// Review (APPROVE or REJECT) a pending claim — restricted to item owner or admin
router.patch("/:id/review", async (req, res) => {
  try {
    const { id } = req.params;
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};
    if (
      body.reviewNote !== undefined &&
      typeof body.reviewNote !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Review note must be a string",
      });
    }
    const status =
      typeof body.status === "string"
        ? body.status.trim().toUpperCase()
        : "";
    const reviewNote =
      typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid claim ID",
      });
    }

    if (!ALLOWED_REVIEW_DECISIONS.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Review status must be APPROVED or REJECTED",
      });
    }

    if (reviewNote.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Review note must be 500 characters or fewer",
      });
    }

    const claim = await Claim.findById(id);
    if (!claim) {
      return res.status(404).json({
        success: false,
        message: "Claim not found",
      });
    }

    const item = await Item.findById(claim.item);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Associated item report not found",
      });
    }

    const reviewerIdStr = req.user._id.toString();
    const isItemOwner =
      Boolean(item.reportedBy) &&
      item.reportedBy.toString() === reviewerIdStr;
    const isAdmin = req.user.role === "admin";
    const isClaimant =
      Boolean(claim.claimant) &&
      claim.claimant.toString() === reviewerIdStr;

    // Claimant can never review their own claim, even if they have admin role
    if (isClaimant) {
      return res.status(403).json({
        success: false,
        message: "You cannot review your own claim",
      });
    }

    if (!isItemOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Only the report owner or an administrator can review this claim",
      });
    }

    if (item.moderated === true || item.status === "CLOSED") {
      return res.status(409).json({
        success: false,
        message: "Cannot review claims for a closed or moderated report",
      });
    }

    if (claim.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: `Claim has already been ${claim.status.toLowerCase()}`,
      });
    }

    const now = new Date();

    if (status === "APPROVED") {
      // Atomic conditional item transition to prevent concurrent double-approvals
      const lockedItem = await Item.findOneAndUpdate(
        {
          _id: item._id,
          moderated: { $ne: true },
          status: { $in: ["OPEN", "CLAIM_PENDING"] },
        },
        {
          $set: { status: "RETURNED" },
        },
        { returnDocument: "after" }
      );

      if (!lockedItem) {
        return res.status(409).json({
          success: false,
          message:
            "Another claim was already approved or the report is no longer eligible",
        });
      }

      try {
        const updatedClaim = await Claim.findOneAndUpdate(
          {
            _id: claim._id,
            status: "PENDING",
          },
          {
            $set: {
              status: "APPROVED",
              reviewedBy: req.user._id,
              reviewedAt: now,
              reviewNote: reviewNote || "Ownership verified and approved",
            },
          },
          { returnDocument: "after" }
        )
          .populate(
            "item",
            "_id title category type location itemDate status rewardAmountPaise rewardCurrency rewardStatus rewardSettledAt rewardSettlement"
          )
          .populate(
            "linkedLostItem",
            "_id title category type location itemDate status rewardAmountPaise rewardCurrency rewardStatus rewardSettledAt rewardSettlement"
          )
          .populate("claimant", "_id name email")
          .populate("reviewedBy", "_id name role");

        if (!updatedClaim) {
          // Reconcile item status based on actual remaining claims
          await reconcileItemClaimStatus(item._id);
          return res.status(409).json({
            success: false,
            message: "Claim state changed concurrently",
          });
        }

        // Automatically reject any other remaining PENDING claims for this item
        const competingPendingClaims = await Claim.find({
          item: item._id,
          _id: { $ne: claim._id },
          status: "PENDING",
        });

        if (competingPendingClaims.length > 0) {
          await Claim.updateMany(
            {
              item: item._id,
              _id: { $ne: claim._id },
              status: "PENDING",
            },
            {
              $set: {
                status: "REJECTED",
                reviewedBy: req.user._id,
                reviewedAt: now,
                reviewNote: "Another claim was approved for this item",
              },
            }
          );
        }

        // Handle voluntary monetary reward settlement transition upon verified return
        if (
          lockedItem.type === "LOST" &&
          lockedItem.rewardStatus === "OFFERED"
        ) {
          lockedItem.rewardStatus = "SETTLEMENT_PENDING";
          lockedItem.rewardSettlement = {
            linkedClaimId: updatedClaim._id,
            linkedFoundItemId: null,
            ownerUserId: lockedItem.reportedBy || req.user._id,
            finderUserId: claim.claimant,
            ownerConfirmedAt: null,
            finderConfirmedAt: null,
            ownerConfirmedBy: null,
            finderConfirmedBy: null,
          };
          await lockedItem.save();
          if (updatedClaim.item) {
            updatedClaim.item.rewardStatus = lockedItem.rewardStatus;
            updatedClaim.item.rewardSettlement = lockedItem.rewardSettlement;
          }
          try {
            await notifyRewardSettlementUpdate({
              item: lockedItem,
              claim: updatedClaim,
              stage: "SETTLEMENT_PENDING",
            });
          } catch (settlementNotifErr) {
            console.error(
              "Reward settlement pending notification error:",
              settlementNotifErr.message
            );
          }
        } else if (lockedItem.type === "FOUND" && claim.linkedLostItem) {
          const linkedLost = await Item.findById(claim.linkedLostItem);
          if (linkedLost && !linkedLost.moderated) {
            linkedLost.status = "RETURNED";
            if (linkedLost.rewardStatus === "OFFERED") {
              linkedLost.rewardStatus = "SETTLEMENT_PENDING";
              linkedLost.rewardSettlement = {
                linkedClaimId: updatedClaim._id,
                linkedFoundItemId: lockedItem._id,
                ownerUserId: linkedLost.reportedBy || claim.claimant,
                finderUserId: lockedItem.reportedBy || req.user._id,
                ownerConfirmedAt: null,
                finderConfirmedAt: null,
                ownerConfirmedBy: null,
                finderConfirmedBy: null,
              };
            }
            await linkedLost.save();
            if (updatedClaim.linkedLostItem) {
              updatedClaim.linkedLostItem.status = linkedLost.status;
              updatedClaim.linkedLostItem.rewardStatus =
                linkedLost.rewardStatus;
              updatedClaim.linkedLostItem.rewardSettlement =
                linkedLost.rewardSettlement;
            }
            if (linkedLost.rewardStatus === "SETTLEMENT_PENDING") {
              try {
                await notifyRewardSettlementUpdate({
                  item: linkedLost,
                  claim: updatedClaim,
                  stage: "SETTLEMENT_PENDING",
                });
              } catch (settlementNotifErr) {
                console.error(
                  "Linked reward settlement pending notification error:",
                  settlementNotifErr.message
                );
              }
            }
          }
        }

        logClaimReview({
          reviewer: req.user,
          claimId: updatedClaim._id,
          itemId: item._id,
          decision: "APPROVED",
        });

        let rewards = null;
        try {
          rewards = await awardVerifiedReturnXp({
            item: lockedItem,
            claim: updatedClaim,
          });
        } catch (rewardError) {
          console.error("Verified return reward error:", rewardError.message);
        }

        try {
          await notifyClaimReviewed({
            item: lockedItem,
            claim: updatedClaim,
            decision: "APPROVED",
          });
          for (const competingClaim of competingPendingClaims) {
            await notifyClaimReviewed({
              item: lockedItem,
              claim: competingClaim,
              decision: "REJECTED",
            });
          }
        } catch (notifError) {
          console.error("Claim approved notification error:", notifError.message);
        }

        return res.json({
          success: true,
          message: "Claim approved and item marked as RETURNED",
          claim: updatedClaim,
          rewards,
        });
      } catch (innerError) {
        // Reconcile item status if unique index or DB error interrupted approval
        await reconcileItemClaimStatus(item._id);
        if (innerError.code === 11000) {
          return res.status(409).json({
            success: false,
            message: "A claim has already been approved for this item",
          });
        }
        throw innerError;
      }
    }

    // Handle REJECTED decision
    const rejectedClaim = await Claim.findOneAndUpdate(
      {
        _id: claim._id,
        status: "PENDING",
      },
      {
        $set: {
          status: "REJECTED",
          reviewedBy: req.user._id,
          reviewedAt: now,
          reviewNote: reviewNote || "Ownership proof was not sufficient",
        },
      },
      { returnDocument: "after" }
    )
      .populate("item", "_id title category type location itemDate status")
      .populate("claimant", "_id name email")
      .populate("reviewedBy", "_id name role");

    if (!rejectedClaim) {
      return res.status(409).json({
        success: false,
        message: "Claim has already been reviewed",
      });
    }

    // Reconcile item status (reverts CLAIM_PENDING -> OPEN only if 0 active claims remain)
    const reconciledStatus = await reconcileItemClaimStatus(item._id);
    if (rejectedClaim.item) {
      rejectedClaim.item.status = reconciledStatus;
    }

    logClaimReview({
      reviewer: req.user,
      claimId: rejectedClaim._id,
      itemId: item._id,
      decision: "REJECTED",
    });

    try {
      await notifyClaimReviewed({
        item,
        claim: rejectedClaim,
        decision: "REJECTED",
      });
    } catch (notifError) {
      console.error("Claim rejected notification error:", notifError.message);
    }

    return res.json({
      success: true,
      message: "Claim rejected",
      claim: rejectedClaim,
    });
  } catch (error) {
    console.error("Review claim error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not review claim",
    });
  }
});

export default router;
