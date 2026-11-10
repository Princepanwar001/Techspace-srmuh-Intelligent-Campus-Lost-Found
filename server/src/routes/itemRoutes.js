import express from "express";
import jwt from "jsonwebtoken";
import Item from "../models/Item.js";
import Claim from "../models/Claim.js";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";
import mongoose from "mongoose";
import {
  ELIGIBLE_MATCH_STATUSES,
  findMatchesForItem,
  isItemEligibleForMatching,
} from "../utils/matchingEngine.js";
import {
  awardReportCreationXp,
  revokeModeratedReportXp,
} from "../utils/rewardEngine.js";
import {
  MAX_IMAGES_PER_ITEM,
  createPrivateImageAccessToken,
  deleteImageFromCloud,
  deleteMultipleImagesFromCloud,
  parseMultipartImagePayload,
  readLocalImageFile,
  uploadImageToCloud,
  validateAndPrepareImageInput,
  verifyPrivateImageAccessToken,
} from "../utils/imageStorageService.js";
import { notifyRewardSettlementUpdate } from "../utils/notificationService.js";

const router = express.Router();

const ALLOWED_CATEGORIES = [
  "Electronics",
  "Documents",
  "Bags",
  "Clothing",
  "Accessories",
  "Books",
  "Keys",
  "Other",
];

const ALLOWED_TYPES = ["LOST", "FOUND"];

const ALLOWED_PUBLIC_STATUSES = [
  "OPEN",
  "MATCHED",
  "CLAIM_PENDING",
  "RETURNED",
  "CLOSED",
];

const SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  itemDate_desc: { itemDate: -1, _id: -1 },
  itemDate_asc: { itemDate: 1, _id: 1 },
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MIN_OFFERED_REWARD_PAISE = 100; // ₹1.00

export function getMaxRewardPaise() {
  const parsed = Number.parseInt(
    process.env.MAX_REWARD_PAISE || "5000000",
    10
  );
  return Number.isSafeInteger(parsed) && parsed >= 10000 ? parsed : 5000000;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStrictPositiveInt(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function parseValidItemDate(rawDate) {
  if (typeof rawDate !== "string" && !(rawDate instanceof Date)) {
    return null;
  }
  if (typeof rawDate === "string" && rawDate.trim().length === 0) {
    return null;
  }
  const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate.trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const minTime = Date.UTC(2000, 0, 1);
  const maxFutureTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < minTime || parsed.getTime() > maxFutureTime) {
    return null;
  }
  return parsed;
}

async function resolveOptionalViewer(req) {
  const authHeader = req.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match || !process.env.JWT_SECRET) {
    return null;
  }
  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload !== "object" ||
      !payload.sub ||
      !mongoose.isValidObjectId(payload.sub)
    ) {
      return null;
    }
    const user = await User.findById(payload.sub)
      .select("_id name email role")
      .lean();
    if (!user) return null;
    return {
      ...user,
      role: user.role === "admin" ? "admin" : "student",
    };
  } catch {
    return null;
  }
}

/**
 * Sanitize an Item document for API output:
 * - PUBLIC images are always visible.
 * - PRIVATE images (ownership evidence) are visible ONLY to the report owner or an admin.
 * - Sensitive storage/financial fields are stripped from public responses.
 */
export function sanitizeItemForViewer(
  itemDoc,
  viewerUser = null,
  { forcePublic = false } = {}
) {
  if (!itemDoc) return null;
  const plain =
    typeof itemDoc.toObject === "function"
      ? itemDoc.toObject()
      : { ...itemDoc };

  const viewerIdStr = viewerUser?._id ? viewerUser._id.toString() : "";
  const isAdmin = !forcePublic && viewerUser?.role === "admin";
  const ownerIdStr = plain.reportedBy
    ? (plain.reportedBy._id || plain.reportedBy).toString()
    : "";
  const isOwner = !forcePublic && Boolean(viewerIdStr && viewerIdStr === ownerIdStr);
  const finderIdStr = plain.rewardSettlement?.finderUserId
    ? (
        plain.rewardSettlement.finderUserId._id ||
        plain.rewardSettlement.finderUserId
      ).toString()
    : "";
  const isFinder =
    !forcePublic && Boolean(viewerIdStr && viewerIdStr === finderIdStr);

  const canViewPrivateImages = isOwner || isAdmin;
  const rawImages = Array.isArray(plain.images) ? plain.images : [];
  const privateImageCount = rawImages.filter(
    (img) => img && img.visibility === "PRIVATE"
  ).length;

  const visibleImages = rawImages
    .filter(
      (img) =>
        img && (canViewPrivateImages || img.visibility === "PUBLIC")
    )
    .map((img) => {
      let resolvedUrl = typeof img.url === "string" ? img.url.split("?")[0] : "";
      if (
        canViewPrivateImages &&
        img.visibility === "PRIVATE" &&
        resolvedUrl.includes("/api/items/media/") &&
        img.publicId
      ) {
        const accessToken = createPrivateImageAccessToken(
          plain._id,
          img.publicId
        );
        resolvedUrl = `${resolvedUrl}?access=${accessToken}`;
      }

      const sanitizedImg = {
        _id: img._id,
        url: resolvedUrl,
        visibility: img.visibility || "PUBLIC",
        mimeType: img.mimeType || "image/jpeg",
        sizeBytes: img.sizeBytes || null,
        createdAt: img.createdAt || null,
      };
      if (canViewPrivateImages) {
        sanitizedImg.publicId = img.publicId;
        sanitizedImg.uploadedBy = img.uploadedBy;
      }
      return sanitizedImg;
    });

  const rawSettlement = plain.rewardSettlement || {};
  const sanitizedSettlement = {
    ownerConfirmed: Boolean(rawSettlement.ownerConfirmedAt),
    finderConfirmed: Boolean(rawSettlement.finderConfirmedAt),
    ownerConfirmedAt: rawSettlement.ownerConfirmedAt || null,
    finderConfirmedAt: rawSettlement.finderConfirmedAt || null,
  };

  if (isOwner || isFinder || isAdmin) {
    sanitizedSettlement.linkedClaimId = rawSettlement.linkedClaimId || null;
    sanitizedSettlement.linkedFoundItemId =
      rawSettlement.linkedFoundItemId || null;
    sanitizedSettlement.ownerUserId =
      rawSettlement.ownerUserId || plain.reportedBy || null;
    sanitizedSettlement.finderUserId = rawSettlement.finderUserId || null;
    sanitizedSettlement.paymentMethodNote =
      rawSettlement.paymentMethodNote || "";
  }

  return {
    ...plain,
    images: visibleImages,
    privateImageCount,
    rewardAmountPaise:
      typeof plain.rewardAmountPaise === "number" ? plain.rewardAmountPaise : 0,
    rewardCurrency: plain.rewardCurrency || "INR",
    rewardStatus: plain.rewardStatus || "NONE",
    rewardOfferedBy: plain.rewardOfferedBy || null,
    rewardSettledAt: plain.rewardSettledAt || null,
    rewardSettlement: sanitizedSettlement,
  };
}

/**
 * Parse and validate optional monetary reward input (integer paise in INR).
 */
export function validateRewardOfferInput(body, effectiveType) {
  if (!body || typeof body !== "object") {
    return { valid: true, hasRewardUpdate: false };
  }

  // Block client attempts to spoof rewardOfferedBy, rewardSettledAt, or rewardSettlement
  if (
    body.rewardOfferedBy !== undefined ||
    body.rewardSettledAt !== undefined ||
    body.rewardSettlement !== undefined
  ) {
    return {
      valid: false,
      status: 400,
      message:
        "Reward ownership and settlement records are server-authoritative and cannot be set by clients",
    };
  }

  if (
    body.rewardCurrency !== undefined &&
    body.rewardCurrency !== "INR"
  ) {
    return {
      valid: false,
      status: 400,
      message: "Only INR reward currency is supported",
    };
  }

  if (body.rewardStatus !== undefined) {
    if (typeof body.rewardStatus !== "string") {
      return {
        valid: false,
        status: 400,
        message: "Invalid rewardStatus format",
      };
    }
    const normStatus = body.rewardStatus.trim().toUpperCase();
    if (
      normStatus === "SETTLED" ||
      normStatus === "SETTLEMENT_PENDING"
    ) {
      return {
        valid: false,
        status: 409,
        message:
          "Cannot directly transition rewardStatus to SETTLEMENT_PENDING or SETTLED without mutual handover confirmation",
      };
    }
    if (!["NONE", "OFFERED", "CANCELLED"].includes(normStatus)) {
      return {
        valid: false,
        status: 400,
        message: "Invalid rewardStatus value",
      };
    }
  }

  const hasPaise = body.rewardAmountPaise !== undefined;
  const hasInr =
    body.rewardAmountInr !== undefined &&
    body.rewardAmountInr !== "" &&
    body.rewardAmountInr !== null;

  if (!hasPaise && !hasInr && body.rewardStatus === undefined) {
    return { valid: true, hasRewardUpdate: false };
  }

  let amountPaise = 0;

  if (hasPaise) {
    const rawPaise = body.rewardAmountPaise;
    if (
      typeof rawPaise !== "number" ||
      !Number.isInteger(rawPaise)
    ) {
      return {
        valid: false,
        status: 400,
        message: "rewardAmountPaise must be an integer number of paise",
      };
    }
    amountPaise = rawPaise;
  } else if (hasInr) {
    const rawInr = body.rewardAmountInr;
    if (
      typeof rawInr !== "number" &&
      typeof rawInr !== "string"
    ) {
      return {
        valid: false,
        status: 400,
        message: "Invalid reward amount in INR",
      };
    }
    const parsedInr =
      typeof rawInr === "string" ? Number(rawInr.trim()) : rawInr;
    if (!Number.isFinite(parsedInr)) {
      return {
        valid: false,
        status: 400,
        message: "Invalid reward amount in INR",
      };
    }
    const scaled = parsedInr * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      return {
        valid: false,
        status: 400,
        message: "Reward amount cannot have more than 2 decimal places",
      };
    }
    amountPaise = Math.round(scaled);
  }

  if (amountPaise < 0) {
    return {
      valid: false,
      status: 400,
      message: "Reward amount cannot be negative",
    };
  }

  const maxPaise = getMaxRewardPaise();
  if (amountPaise > maxPaise) {
    return {
      valid: false,
      status: 400,
      message: `Reward amount exceeds the maximum safe limit of ₹${Math.floor(
        maxPaise / 100
      )} (${maxPaise} paise)`,
    };
  }

  if (amountPaise > 0 && amountPaise < MIN_OFFERED_REWARD_PAISE) {
    return {
      valid: false,
      status: 400,
      message: "Minimum optional reward offer is ₹1 (100 paise)",
    };
  }

  const normalizedType =
    typeof effectiveType === "string"
      ? effectiveType.trim().toUpperCase()
      : "";

  const requestedStatus =
    typeof body.rewardStatus === "string"
      ? body.rewardStatus.trim().toUpperCase()
      : null;

  if (
    normalizedType !== "LOST" &&
    (amountPaise > 0 || requestedStatus === "OFFERED")
  ) {
    return {
      valid: false,
      status: 400,
      message:
        "Found-item reporters cannot create a reward offer. Voluntary monetary rewards are only allowed on LOST item reports.",
    };
  }

  if (requestedStatus === "OFFERED" && amountPaise <= 0) {
    return {
      valid: false,
      status: 400,
      message: "A positive reward amount is required when rewardStatus is OFFERED",
    };
  }

  return {
    valid: true,
    hasRewardUpdate: true,
    rewardAmountPaise: requestedStatus === "CANCELLED" ? 0 : amountPaise,
    rewardStatus:
      requestedStatus === "CANCELLED"
        ? "CANCELLED"
        : amountPaise > 0
          ? "OFFERED"
          : "NONE",
  };
}

// Get reports belonging to the logged-in user
router.get("/mine", requireAuth, async (req, res) => {
  try {
    if (Object.keys(req.query || {}).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameter",
      });
    }

    const items = await Item.find({
      reportedBy: req.user._id,
    })
      .select("-moderatedBy -__v")
      .sort({ createdAt: -1 });

    const sanitizedItems = items.map((item) =>
      sanitizeItemForViewer(item, req.user)
    );

    return res.json({
      success: true,
      count: sanitizedItems.length,
      items: sanitizedItems,
    });
  } catch (error) {
    console.error("Fetch my reports error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not fetch your reports",
    });
  }
});

const ALLOWED_QUERY_KEYS = new Set([
  "q",
  "search",
  "type",
  "category",
  "location",
  "status",
  "dateFrom",
  "dateTo",
  "sort",
  "page",
  "limit",
]);

// Get all public items with search, filters, sorting, and pagination
router.get("/", async (req, res) => {
  try {
    // Reject unknown/operator-injected query keys or non-string values (e.g. arrays/objects)
    for (const [key, val] of Object.entries(req.query)) {
      if (!ALLOWED_QUERY_KEYS.has(key) || typeof val !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter format",
        });
      }
    }

    const rawSearch =
      req.query.q !== undefined ? req.query.q : req.query.search;
    const {
      type,
      category,
      location,
      status,
      dateFrom,
      dateTo,
      sort,
      page: rawPage,
      limit: rawLimit,
    } = req.query;

    const basePublicFilter = { moderated: { $ne: true } };
    const filter = { ...basePublicFilter };

    // 1. Search (title or description)
    if (rawSearch !== undefined) {
      const trimmedSearch = rawSearch.trim();
      if (trimmedSearch.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Search query must be 100 characters or fewer",
        });
      }
      if (trimmedSearch.length > 0) {
        const safeRegex = new RegExp(escapeRegex(trimmedSearch), "i");
        filter.$or = [{ title: safeRegex }, { description: safeRegex }];
      }
    }

    // 2. Filter by report type (LOST / FOUND)
    if (type !== undefined && type.trim() !== "") {
      const normalizedType = type.trim().toUpperCase();
      if (!ALLOWED_TYPES.includes(normalizedType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid report type filter",
        });
      }
      filter.type = normalizedType;
    }

    // 3. Filter by category
    if (category !== undefined && category.trim() !== "") {
      const trimmedCategory = category.trim();
      if (!ALLOWED_CATEGORIES.includes(trimmedCategory)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category filter",
        });
      }
      filter.category = trimmedCategory;
    }

    // 4. Filter by location (safe escaped substring match)
    if (location !== undefined) {
      const trimmedLocation = location.trim();
      if (trimmedLocation.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Location filter must be 100 characters or fewer",
        });
      }
      if (trimmedLocation.length > 0) {
        filter.location = new RegExp(escapeRegex(trimmedLocation), "i");
      }
    }

    // 5. Filter by status
    if (status !== undefined && status.trim() !== "") {
      const normalizedStatus = status.trim().toUpperCase();
      if (!ALLOWED_PUBLIC_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status filter",
        });
      }
      filter.status = normalizedStatus;
    }

    // 6. Filter by itemDate range (dateFrom / dateTo)
    if (
      (dateFrom !== undefined && dateFrom.trim() !== "") ||
      (dateTo !== undefined && dateTo.trim() !== "")
    ) {
      const dateFilter = {};

      if (dateFrom !== undefined && dateFrom.trim() !== "") {
        const parsedFrom = new Date(dateFrom.trim());
        if (Number.isNaN(parsedFrom.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid dateFrom filter",
          });
        }
        parsedFrom.setUTCHours(0, 0, 0, 0);
        dateFilter.$gte = parsedFrom;
      }

      if (dateTo !== undefined && dateTo.trim() !== "") {
        const parsedTo = new Date(dateTo.trim());
        if (Number.isNaN(parsedTo.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid dateTo filter",
          });
        }
        parsedTo.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = parsedTo;
      }

      if (
        dateFilter.$gte &&
        dateFilter.$lte &&
        dateFilter.$gte > dateFilter.$lte
      ) {
        return res.status(400).json({
          success: false,
          message: "dateFrom cannot be later than dateTo",
        });
      }

      filter.itemDate = dateFilter;
    }

    // 7. Sorting validation
    const sortKey =
      sort !== undefined && sort.trim() !== "" ? sort.trim() : "newest";
    const sortSpec = SORT_OPTIONS[sortKey];
    if (!sortSpec) {
      return res.status(400).json({
        success: false,
        message: "Invalid sort option",
      });
    }

    // 8. Pagination validation
    let page = DEFAULT_PAGE;
    if (rawPage !== undefined && rawPage.trim() !== "") {
      const parsedPage = parseStrictPositiveInt(rawPage);
      if (!parsedPage) {
        return res.status(400).json({
          success: false,
          message: "Page must be a positive integer",
        });
      }
      page = parsedPage;
    }

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined && rawLimit.trim() !== "") {
      const parsedLimit = parseStrictPositiveInt(rawLimit);
      if (!parsedLimit || parsedLimit > MAX_LIMIT) {
        return res.status(400).json({
          success: false,
          message: `Limit must be a positive integer between 1 and ${MAX_LIMIT}`,
        });
      }
      limit = parsedLimit;
    }

    const skip = (page - 1) * limit;

    const [items, totalItems, totalPublic, lostPublic, foundPublic] =
      await Promise.all([
        Item.find(filter)
          .select("-moderated -moderatedAt -moderatedBy -moderationReason")
          .sort(sortSpec)
          .skip(skip)
          .limit(limit),
        Item.countDocuments(filter),
        Item.countDocuments(basePublicFilter),
        Item.countDocuments({ ...basePublicFilter, type: "LOST" }),
        Item.countDocuments({ ...basePublicFilter, type: "FOUND" }),
      ]);

    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    // Resolve optional viewer so owners/admins see their own PRIVATE images while
    // unauthenticated and non-owner callers only receive PUBLIC images.
    const viewer = await resolveOptionalViewer(req);
    const publicSafeItems = items.map((item) =>
      sanitizeItemForViewer(item, viewer)
    );

    res.json({
      success: true,
      count: publicSafeItems.length,
      items: publicSafeItems,
      pagination: {
        totalItems,
        currentPage: page,
        pageSize: limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      stats: {
        total: totalPublic,
        lost: lostPublic,
        found: foundPublic,
      },
    });
  } catch (error) {
    console.error("Fetch items error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not fetch items",
    });
  }
});

// Serve locally persisted item photos with strict PRIVATE ownership evidence protection
router.get("/media/:itemId/:fileName", async (req, res) => {
  try {
    const { itemId, fileName } = req.params;
    if (
      !mongoose.isValidObjectId(itemId) ||
      typeof fileName !== "string" ||
      !/^[a-zA-Z0-9._-]+$/.test(fileName)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid media path",
      });
    }

    const item = await Item.findById(itemId)
      .select("reportedBy moderated images")
      .lean();
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Media not found",
      });
    }

    const expectedPublicId = `local/items/${itemId}/${fileName}`;
    const matchedImage = (item.images || []).find(
      (img) =>
        img &&
        (img.publicId === expectedPublicId ||
          (typeof img.url === "string" &&
            img.url.split("?")[0].endsWith(`/media/${itemId}/${fileName}`)))
    );

    if (!matchedImage) {
      return res.status(404).json({
        success: false,
        message: "Media not found",
      });
    }

    const viewer = await resolveOptionalViewer(req);
    const isAdmin = viewer?.role === "admin";
    const isOwner =
      Boolean(viewer?._id && item.reportedBy) &&
      viewer._id.toString() === item.reportedBy.toString();

    if (item.moderated === true && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: "Media not found",
      });
    }

    if (matchedImage.visibility === "PRIVATE") {
      const accessQueryToken =
        typeof req.query?.access === "string" ? req.query.access.trim() : "";
      const hasValidAccessParam = verifyPrivateImageAccessToken(
        item._id,
        matchedImage.publicId,
        accessQueryToken
      );

      if (!isOwner && !isAdmin && !hasValidAccessParam) {
        return res.status(403).json({
          success: false,
          message:
            "Private ownership evidence image is accessible only to the report owner or an administrator",
        });
      }
    }

    const fileBuffer = await readLocalImageFile(itemId, fileName);
    if (!fileBuffer) {
      return res.status(404).json({
        success: false,
        message: "Media file not found on storage",
      });
    }

    res.setHeader("Content-Type", matchedImage.mimeType || "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader(
      "Cache-Control",
      matchedImage.visibility === "PRIVATE"
        ? "private, no-store"
        : "public, max-age=86400"
    );
    return res.send(fileBuffer);
  } catch (error) {
    console.error("Serve item media error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not serve media file",
    });
  }
});

// Get a single item's details (PUBLIC images for everyone; PRIVATE images only for owner/admin)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    if (Object.keys(req.query || {}).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameter",
      });
    }

    const viewer = await resolveOptionalViewer(req);
    const item = await Item.findById(id).select(
      "-moderated -moderatedAt -moderatedBy -moderationReason"
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    // Check if moderated in DB
    const modCheck = await Item.findById(id).select("moderated").lean();
    if (modCheck?.moderated === true && viewer?.role !== "admin") {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    return res.json({
      success: true,
      item: sanitizeItemForViewer(item, viewer),
    });
  } catch (error) {
    console.error("Get single item error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not fetch item details",
    });
  }
});

// Create a lost/found report (with optional monetary reward offer on LOST items)
router.post("/", requireAuth, async (req, res) => {
  try {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};
    const {
      title,
      description,
      category,
      type,
      location,
      itemDate,
    } = body;

    if (
      !title ||
      !description ||
      !category ||
      !type ||
      !location ||
      !itemDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    if (
      typeof title !== "string" ||
      typeof description !== "string" ||
      typeof category !== "string" ||
      typeof type !== "string" ||
      typeof location !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid item details",
      });
    }

    const parsedDate = parseValidItemDate(itemDate);
    if (!parsedDate) {
      return res.status(400).json({
        success: false,
        message: "Invalid item details",
      });
    }

    const rewardCheck = validateRewardOfferInput(body, type);
    if (!rewardCheck.valid) {
      return res.status(rewardCheck.status || 400).json({
        success: false,
        message: rewardCheck.message,
      });
    }

    const rewardAmountPaise = rewardCheck.hasRewardUpdate
      ? rewardCheck.rewardAmountPaise
      : 0;
    const rewardStatus =
      rewardAmountPaise > 0 && type === "LOST" ? "OFFERED" : "NONE";

    const item = await Item.create({
      title,
      description,
      category,
      type,
      location,
      itemDate: parsedDate,
      reportedBy: req.user._id,
      rewardAmountPaise,
      rewardCurrency: "INR",
      rewardStatus,
      rewardOfferedBy: rewardStatus === "OFFERED" ? req.user._id : null,
      rewardSettledAt: null,
      rewardSettlement:
        rewardStatus === "OFFERED"
          ? { ownerUserId: req.user._id }
          : {},
    });

    let reward = null;
    try {
      reward = await awardReportCreationXp({
        userId: req.user._id,
        item,
      });
    } catch (rewardError) {
      console.error("Report reward award error:", rewardError.message);
    }

    res.status(201).json({
      success: true,
      message: "Item report created successfully",
      item: sanitizeItemForViewer(item, req.user),
      reward,
    });
  } catch (error) {
    if (
      error.name === "ValidationError" ||
      error.name === "CastError"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid item details",
      });
    }

    console.error("Create item error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not create item",
    });
  }
});

// Upload 1..5 photos (JPEG, PNG, WebP, <= 5 MB each) for an item report
router.post("/:id/images", requireAuth, async (req, res) => {
  const uploadedBatchAssets = [];
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    const item = await Item.findById(id);
    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const isOwner =
      Boolean(item.reportedBy) &&
      item.reportedBy.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to upload or modify images for this report",
      });
    }

    if (item.status !== "OPEN" && !isAdmin) {
      return res.status(409).json({
        success: false,
        message: "Images can only be uploaded while the report is OPEN",
      });
    }

    let rawImageCandidates = [];
    const contentType = (req.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("multipart/form-data")) {
      const parsedMultipart = parseMultipartImagePayload(
        req.body,
        req.get("content-type") || ""
      );
      const visibilitiesField = parsedMultipart.fields.visibilities
        ? Array.isArray(parsedMultipart.fields.visibilities)
          ? parsedMultipart.fields.visibilities
          : [parsedMultipart.fields.visibilities]
        : [];
      const defaultVisibility =
        typeof parsedMultipart.fields.visibility === "string"
          ? parsedMultipart.fields.visibility
          : "PUBLIC";

      rawImageCandidates = parsedMultipart.files.map((file, idx) => ({
        buffer: file.buffer,
        mimeType: file.mimeType,
        fileName: file.fileName,
        visibility: visibilitiesField[idx] || defaultVisibility,
      }));
    } else if (req.body && typeof req.body === "object") {
      if (Array.isArray(req.body.images)) {
        rawImageCandidates = req.body.images;
      } else if (req.body.image && typeof req.body.image === "object") {
        rawImageCandidates = [req.body.image];
      }
    }

    if (!Array.isArray(rawImageCandidates) || rawImageCandidates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one image (JPEG, PNG, or WebP) to upload",
      });
    }

    const existingCount = Array.isArray(item.images) ? item.images.length : 0;
    if (
      rawImageCandidates.length > MAX_IMAGES_PER_ITEM ||
      existingCount + rawImageCandidates.length > MAX_IMAGES_PER_ITEM
    ) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_IMAGES_PER_ITEM} images allowed per report (currently ${existingCount} uploaded)`,
      });
    }

    // Validate all images before invoking external cloud storage
    const validatedImages = [];
    for (const rawImg of rawImageCandidates) {
      const check = validateAndPrepareImageInput(rawImg);
      if (!check.valid) {
        return res.status(check.status || 400).json({
          success: false,
          message: check.message,
        });
      }
      validatedImages.push(check);
    }

    // Upload each EXIF-stripped image to cloud or local storage
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    for (const validImg of validatedImages) {
      const uploadedMeta = await uploadImageToCloud({
        buffer: validImg.buffer,
        mimeType: validImg.mimeType,
        itemId: item._id,
        visibility: validImg.visibility,
        uploadedBy: req.user._id,
        baseUrl: requestOrigin,
      });
      uploadedBatchAssets.push(uploadedMeta);
    }

    item.images.push(...uploadedBatchAssets);
    await item.save();

    return res.status(201).json({
      success: true,
      message: `${uploadedBatchAssets.length} image(s) uploaded successfully`,
      images: sanitizeItemForViewer(item, req.user).images,
      item: sanitizeItemForViewer(item, req.user),
    });
  } catch (error) {
    if (uploadedBatchAssets.length > 0) {
      await deleteMultipleImagesFromCloud(uploadedBatchAssets);
    }

    if (error.code === "STORAGE_NOT_CONFIGURED") {
      return res.status(503).json({
        success: false,
        code: "STORAGE_NOT_CONFIGURED",
        message:
          "Cloud image storage credentials are not configured on the server",
      });
    }

    console.error("Image upload error:", error.message);
    return res.status(502).json({
      success: false,
      code: "STORAGE_UPLOAD_FAILED",
      message: "Cloud image storage service failed to process the upload",
    });
  }
});

// Update visibility (PUBLIC / PRIVATE) of an existing report image
router.patch("/:id/images/:imageId", requireAuth, async (req, res) => {
  try {
    const { id, imageId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(imageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item or image ID",
      });
    }

    const visibility =
      typeof req.body?.visibility === "string"
        ? req.body.visibility.trim().toUpperCase()
        : "";

    if (visibility !== "PUBLIC" && visibility !== "PRIVATE") {
      return res.status(400).json({
        success: false,
        message: "Image visibility must be PUBLIC or PRIVATE",
      });
    }

    const item = await Item.findById(id);
    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const isOwner =
      Boolean(item.reportedBy) &&
      item.reportedBy.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to modify images for this report",
      });
    }

    const targetImg = item.images.id(imageId);
    if (!targetImg) {
      return res.status(404).json({
        success: false,
        message: "Image not found on this report",
      });
    }

    targetImg.visibility = visibility;
    await item.save();

    return res.json({
      success: true,
      message: `Image visibility updated to ${visibility}`,
      item: sanitizeItemForViewer(item, req.user),
    });
  } catch (error) {
    console.error("Update image visibility error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not update image visibility",
    });
  }
});

// Delete an image from an item report and clean up its cloud asset
router.delete("/:id/images/:imageId", requireAuth, async (req, res) => {
  try {
    const { id, imageId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(imageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item or image ID",
      });
    }

    const item = await Item.findById(id);
    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const isOwner =
      Boolean(item.reportedBy) &&
      item.reportedBy.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete images from this report",
      });
    }

    if (item.status !== "OPEN" && !isAdmin) {
      return res.status(409).json({
        success: false,
        message: "Images can only be removed while the report is OPEN",
      });
    }

    const targetImg = item.images.id(imageId);
    if (!targetImg) {
      return res.status(404).json({
        success: false,
        message: "Image not found on this report",
      });
    }

    const publicIdToDelete = targetImg.publicId;
    targetImg.deleteOne();
    await item.save();

    await deleteImageFromCloud(publicIdToDelete);

    return res.json({
      success: true,
      message: "Image removed from report",
      item: sanitizeItemForViewer(item, req.user),
    });
  } catch (error) {
    console.error("Delete item image error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not remove image from report",
    });
  }
});

// Modify or cancel an optional monetary reward offer on a LOST item report
router.patch("/:id/reward", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    const item = await Item.findById(id);
    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const isOwner =
      Boolean(item.reportedBy) &&
      item.reportedBy.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Only the report owner or an authorized administrator can modify or cancel the reward offer",
      });
    }

    if (item.type !== "LOST") {
      return res.status(400).json({
        success: false,
        message:
          "Monetary rewards can only be offered on LOST item reports",
      });
    }

    if (
      item.rewardStatus === "SETTLEMENT_PENDING" ||
      item.rewardStatus === "SETTLED" ||
      item.status === "RETURNED" ||
      item.status === "CLOSED"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot modify or cancel a reward once the item is returned, closed, or in settlement",
      });
    }

    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    const action =
      typeof body.action === "string"
        ? body.action.trim().toUpperCase()
        : "";

    if (action === "CANCEL" || body.rewardStatus === "CANCELLED") {
      if (item.rewardStatus !== "OFFERED") {
        return res.status(409).json({
          success: false,
          message: "No active reward offer to cancel",
        });
      }
      item.rewardAmountPaise = 0;
      item.rewardStatus = "CANCELLED";
      await item.save();

      return res.json({
        success: true,
        message: "Voluntary reward offer cancelled",
        item: sanitizeItemForViewer(item, req.user),
      });
    }

    const rewardCheck = validateRewardOfferInput(body, item.type);
    if (!rewardCheck.valid) {
      return res.status(rewardCheck.status || 400).json({
        success: false,
        message: rewardCheck.message,
      });
    }

    if (!rewardCheck.hasRewardUpdate) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid rewardAmountPaise, rewardAmountInr, or action='CANCEL'",
      });
    }

    if (rewardCheck.rewardAmountPaise === 0) {
      if (item.rewardStatus === "OFFERED") {
        item.rewardAmountPaise = 0;
        item.rewardStatus = "CANCELLED";
      } else {
        item.rewardAmountPaise = 0;
        item.rewardStatus = "NONE";
      }
    } else {
      item.rewardAmountPaise = rewardCheck.rewardAmountPaise;
      item.rewardCurrency = "INR";
      item.rewardStatus = "OFFERED";
      item.rewardOfferedBy = item.reportedBy;
      if (!item.rewardSettlement) {
        item.rewardSettlement = {};
      }
      item.rewardSettlement.ownerUserId = item.reportedBy;
    }

    await item.save();

    return res.json({
      success: true,
      message:
        item.rewardStatus === "OFFERED"
          ? "Voluntary reward offer updated"
          : "Voluntary reward offer cancelled",
      item: sanitizeItemForViewer(item, req.user),
    });
  } catch (error) {
    console.error("Modify item reward error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not update reward offer",
    });
  }
});

// Mutual confirmation of voluntary reward settlement by owner and finder
async function handleConfirmRewardSettlement(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    if (
      body.paymentMethodNote !== undefined &&
      typeof body.paymentMethodNote !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "paymentMethodNote must be a string",
      });
    }

    const rawNote =
      typeof body.paymentMethodNote === "string"
        ? body.paymentMethodNote.trim()
        : "";
    if (rawNote.length > 120) {
      return res.status(400).json({
        success: false,
        message: "paymentMethodNote must be 120 characters or fewer",
      });
    }

    // Never allow storing sensitive card numbers, CVVs, or UPI PINs
    if (/\b(?:\d[ -]*?){12,19}\b/.test(rawNote) || /\bpin\b/i.test(rawNote)) {
      return res.status(400).json({
        success: false,
        message:
          "Do not include card numbers, account numbers, or UPI PINs in settlement notes",
      });
    }

    const item = await Item.findById(id);
    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    if (item.type !== "LOST") {
      return res.status(400).json({
        success: false,
        message: "Monetary reward settlement applies only to LOST item reports",
      });
    }

    if (
      item.rewardStatus === "NONE" ||
      item.rewardStatus === "CANCELLED" ||
      (item.rewardAmountPaise || 0) <= 0
    ) {
      return res.status(409).json({
        success: false,
        message: "This report does not have an active reward offer to settle",
      });
    }

    // If rewardStatus is still OFFERED, check if an APPROVED claim can be linked
    if (item.rewardStatus === "OFFERED") {
      let approvedClaim = await Claim.findOne({
        $or: [{ item: item._id }, { linkedLostItem: item._id }],
        status: "APPROVED",
      }).populate("item", "_id type status reportedBy");

      if (
        !approvedClaim &&
        typeof body.claimId === "string" &&
        mongoose.isValidObjectId(body.claimId.trim())
      ) {
        const candidateClaim = await Claim.findById(body.claimId.trim()).populate(
          "item",
          "_id type status reportedBy"
        );
        if (
          candidateClaim &&
          candidateClaim.status === "APPROVED" &&
          candidateClaim.item?.status === "RETURNED" &&
          candidateClaim.claimant?.toString() === item.reportedBy?.toString()
        ) {
          approvedClaim = candidateClaim;
        }
      }

      if (!approvedClaim || item.status !== "RETURNED") {
        return res.status(409).json({
          success: false,
          message:
            "Reward settlement can only be confirmed after a claim is approved and the item is marked as RETURNED",
        });
      }

      const derivedFinderId =
        approvedClaim.item?._id?.toString() === item._id.toString()
          ? approvedClaim.claimant
          : approvedClaim.item?.reportedBy;

      item.rewardStatus = "SETTLEMENT_PENDING";
      item.rewardSettlement = {
        ...(item.rewardSettlement?.toObject?.() || item.rewardSettlement || {}),
        linkedClaimId: approvedClaim._id,
        linkedFoundItemId:
          approvedClaim.item?._id?.toString() !== item._id.toString()
            ? approvedClaim.item?._id
            : null,
        ownerUserId: item.reportedBy,
        finderUserId: derivedFinderId,
      };
    }

    if (item.status !== "RETURNED") {
      return res.status(409).json({
        success: false,
        message:
          "Reward settlement requires the item report to be in RETURNED status",
      });
    }

    const ownerIdStr = (
      item.rewardSettlement?.ownerUserId ||
      item.reportedBy ||
      ""
    ).toString();
    const finderIdStr = (
      item.rewardSettlement?.finderUserId || ""
    ).toString();
    const callerIdStr = req.user._id.toString();

    const isOwnerCaller = Boolean(ownerIdStr && callerIdStr === ownerIdStr);
    const isFinderCaller = Boolean(finderIdStr && callerIdStr === finderIdStr);

    if (!isOwnerCaller && !isFinderCaller) {
      return res.status(403).json({
        success: false,
        message:
          "Only the report owner and the verified finder can confirm reward settlement",
      });
    }

    // Handle idempotent call when already SETTLED
    if (item.rewardStatus === "SETTLED") {
      return res.json({
        success: true,
        idempotent: true,
        alreadyConfirmed: true,
        alreadySettled: true,
        rewardStatus: "SETTLED",
        message:
          "Voluntary reward settlement has already been mutually confirmed and marked as SETTLED",
        disclaimer:
          "LostLink does not hold funds or process payments. Settlement reflects a voluntary off-platform confirmation.",
        item: sanitizeItemForViewer(item, req.user),
      });
    }

    const now = new Date();
    let alreadyConfirmed = false;

    if (!item.rewardSettlement) {
      item.rewardSettlement = {};
    }

    if (isOwnerCaller) {
      if (item.rewardSettlement.ownerConfirmedAt) {
        alreadyConfirmed = true;
      } else {
        item.rewardSettlement.ownerConfirmedAt = now;
        item.rewardSettlement.ownerConfirmedBy = req.user._id;
      }
    }

    if (isFinderCaller) {
      if (item.rewardSettlement.finderConfirmedAt) {
        alreadyConfirmed = true;
      } else {
        item.rewardSettlement.finderConfirmedAt = now;
        item.rewardSettlement.finderConfirmedBy = req.user._id;
      }
    }

    if (rawNote) {
      item.rewardSettlement.paymentMethodNote = rawNote;
    }

    const bothConfirmed = Boolean(
      item.rewardSettlement.ownerConfirmedAt &&
        item.rewardSettlement.finderConfirmedAt
    );

    if (bothConfirmed) {
      item.rewardStatus = "SETTLED";
      if (!item.rewardSettledAt) {
        item.rewardSettledAt = now;
      }
    } else {
      item.rewardStatus = "SETTLEMENT_PENDING";
    }

    await item.save();

    if (bothConfirmed && !alreadyConfirmed) {
      try {
        await notifyRewardSettlementUpdate({
          item,
          stage: "SETTLED",
        });
      } catch (notifErr) {
        console.error("Reward settled notification error:", notifErr.message);
      }
    }

    return res.json({
      success: true,
      idempotent: alreadyConfirmed,
      alreadyConfirmed,
      alreadySettled: item.rewardStatus === "SETTLED",
      rewardStatus: item.rewardStatus,
      message: bothConfirmed
        ? "Mutual settlement confirmation complete! Reward is now marked as SETTLED."
        : alreadyConfirmed
          ? "Your settlement confirmation was already recorded. Waiting for the other party to confirm."
          : isOwnerCaller
            ? "Owner settlement confirmation recorded. Waiting for finder confirmation to mark as SETTLED."
            : "Finder settlement confirmation recorded. Waiting for owner confirmation to mark as SETTLED.",
      disclaimer:
        "LostLink does not hold funds or process payments. Settlement reflects a voluntary off-platform confirmation.",
      item: sanitizeItemForViewer(item, req.user),
    });
  } catch (error) {
    console.error("Confirm reward settlement error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not confirm reward settlement",
    });
  }
}

router.post(
  "/:id/reward/confirm-settlement",
  requireAuth,
  handleConfirmRewardSettlement
);
router.patch("/:id/reward/settle", requireAuth, handleConfirmRewardSettlement);

// Update an item owned by the logged-in user
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    const existingAnyOwner = await Item.findById(id).select(
      "_id reportedBy moderated"
    );
    if (!existingAnyOwner || existingAnyOwner.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const item = await Item.findOne({
      _id: id,
      reportedBy: req.user._id,
    });

    if (!item || item.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    if (item.status !== "OPEN") {
      return res.status(409).json({
        success: false,
        message: "Only open reports can be edited",
      });
    }

    const stringFields = [
      "title",
      "description",
      "category",
      "type",
      "location",
    ];

    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    for (const field of stringFields) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== "string") {
          return res.status(400).json({
            success: false,
            message: "Invalid item details",
          });
        }
        item[field] = body[field];
      }
    }

    if (body.itemDate !== undefined) {
      const parsedDate = parseValidItemDate(body.itemDate);
      if (!parsedDate) {
        return res.status(400).json({
          success: false,
          message: "Invalid item details",
        });
      }
      item.itemDate = parsedDate;
    }

    // If report type changed to FOUND, ensure no active reward offer remains
    if (item.type === "FOUND" && item.rewardStatus === "OFFERED") {
      item.rewardAmountPaise = 0;
      item.rewardStatus = "CANCELLED";
    }

    const rewardCheck = validateRewardOfferInput(body, item.type);
    if (!rewardCheck.valid) {
      return res.status(rewardCheck.status || 400).json({
        success: false,
        message: rewardCheck.message,
      });
    }

    if (rewardCheck.hasRewardUpdate) {
      if (rewardCheck.rewardAmountPaise > 0) {
        item.rewardAmountPaise = rewardCheck.rewardAmountPaise;
        item.rewardCurrency = "INR";
        item.rewardStatus = "OFFERED";
        item.rewardOfferedBy = req.user._id;
        if (!item.rewardSettlement) {
          item.rewardSettlement = {};
        }
        item.rewardSettlement.ownerUserId = req.user._id;
      } else {
        item.rewardAmountPaise = 0;
        item.rewardStatus =
          item.rewardStatus === "OFFERED" ? "CANCELLED" : "NONE";
      }
    }

    await item.save();

    return res.json({
      success: true,
      message: "Report updated successfully",
      item: sanitizeItemForViewer(item, req.user),
    });
  } catch (error) {
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid item details",
      });
    }

    console.error("Update item error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not update report",
    });
  }
});

// Delete an open report owned by the logged-in user
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    const existingItem = await Item.findOne({
      _id: id,
      reportedBy: req.user._id,
    });

    if (!existingItem || existingItem.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    if (existingItem.status !== "OPEN") {
      return res.status(409).json({
        success: false,
        message: "Only open reports can be deleted",
      });
    }

    const deletedItem = await Item.findOneAndDelete({
      _id: id,
      reportedBy: req.user._id,
      status: "OPEN",
      moderated: { $ne: true },
    });

    if (!deletedItem) {
      return res.status(409).json({
        success: false,
        message: "Only open reports can be deleted",
      });
    }

    // Clean up any associated cloud storage assets
    if (Array.isArray(deletedItem.images) && deletedItem.images.length > 0) {
      await deleteMultipleImagesFromCloud(deletedItem.images);
    }

    try {
      await revokeModeratedReportXp(deletedItem);
    } catch (rewardError) {
      console.error("Revoke deleted report XP error:", rewardError.message);
    }

    return res.json({
      success: true,
      message: "Report deleted successfully",
    });
  } catch (error) {
    console.error("Delete item error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not delete report",
    });
  }
});

const ALLOWED_MATCH_QUERY_KEYS = new Set(["limit", "minScore"]);

// Get explainable potential matches for an eligible LOST or FOUND report
router.get("/:id/matches", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID",
      });
    }

    for (const [key, val] of Object.entries(req.query)) {
      if (!ALLOWED_MATCH_QUERY_KEYS.has(key) || typeof val !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter",
        });
      }
    }

    let limit = 5;
    if (req.query.limit !== undefined && req.query.limit.trim() !== "") {
      const parsedLimit = parseStrictPositiveInt(req.query.limit);
      if (!parsedLimit || parsedLimit > 20) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a positive integer between 1 and 20",
        });
      }
      limit = parsedLimit;
    }

    let minScore = 15;
    if (req.query.minScore !== undefined && req.query.minScore.trim() !== "") {
      const parsedMin = parseStrictPositiveInt(req.query.minScore);
      if (!parsedMin || parsedMin > 100) {
        return res.status(400).json({
          success: false,
          message: "minScore must be an integer between 1 and 100",
        });
      }
      minScore = parsedMin;
    }

    const sourceItem = await Item.findById(id).select(
      "_id title description category type location itemDate status reportedBy moderated rewardAmountPaise rewardCurrency rewardStatus createdAt updatedAt"
    );

    if (!sourceItem || sourceItem.moderated === true) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    if (!isItemEligibleForMatching(sourceItem)) {
      return res.status(409).json({
        success: false,
        message: `Reports with status ${sourceItem.status} are not eligible for matching`,
      });
    }

    const oppositeType = sourceItem.type === "LOST" ? "FOUND" : "LOST";

    const candidates = await Item.find({
      _id: { $ne: sourceItem._id },
      type: oppositeType,
      moderated: { $ne: true },
      status: { $in: ELIGIBLE_MATCH_STATUSES },
    })
      .select(
        "_id title description category type location itemDate status reportedBy images rewardAmountPaise rewardCurrency rewardStatus createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .limit(200);

    const matches = findMatchesForItem(sourceItem, candidates, {
      limit,
      minScore,
    });

    return res.json({
      success: true,
      sourceItemId: sourceItem._id,
      sourceType: sourceItem.type,
      candidateType: oppositeType,
      disclaimer:
        "Match scores are heuristic suggestions based on report similarity and do not prove ownership.",
      count: matches.length,
      matches,
    });
  } catch (error) {
    console.error("Fetch item matches error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not compute item matches",
    });
  }
});

export default router;
