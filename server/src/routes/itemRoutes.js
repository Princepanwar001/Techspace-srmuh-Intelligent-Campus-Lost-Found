import express from "express";
import Item from "../models/Item.js";
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

    return res.json({
      success: true,
      count: items.length,
      items,
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

    res.json({
      success: true,
      count: items.length,
      items,
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

// Create a lost/found report
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

    const item = await Item.create({
      title,
      description,
      category,
      type,
      location,
      itemDate: parsedDate,
      reportedBy: req.user._id,
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
      item,
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

    await item.save();

    return res.json({
      success: true,
      message: "Report updated successfully",
      item,
    });
  } catch (error) {
    if (error.name === "ValidationError" ||
        error.name === "CastError") {
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
      "_id title description category type location itemDate status reportedBy moderated createdAt updatedAt"
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
        "_id title description category type location itemDate status reportedBy createdAt updatedAt"
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
