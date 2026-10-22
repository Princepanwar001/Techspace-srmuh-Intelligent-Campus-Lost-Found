import express from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import requireAuth from "../middleware/requireAuth.js";

const router = express.Router();

const ALLOWED_NOTIFICATION_QUERY_KEYS = new Set(["unreadOnly", "limit"]);

function parseStrictPositiveInt(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    return null;
  }
  const num = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

function sanitizeNotification(doc) {
  const plain =
    (typeof doc?.toObject === "function" ? doc.toObject() : doc) || {};
  return {
    _id: plain._id,
    recipient: plain.recipient,
    type: plain.type,
    title: plain.title,
    message: plain.message,
    item: plain.item || null,
    claim: plain.claim || null,
    read: Boolean(plain.read),
    readAt: plain.readAt || null,
    createdAt: plain.createdAt || null,
  };
}

// All notification routes require authentication
router.use(requireAuth);

// List notifications for the authenticated user along with unreadCount
router.get("/", async (req, res) => {
  try {
    for (const [key, val] of Object.entries(req.query)) {
      if (
        !ALLOWED_NOTIFICATION_QUERY_KEYS.has(key) ||
        typeof val !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid query parameter",
        });
      }
    }

    let unreadOnly = false;
    if (req.query.unreadOnly !== undefined && req.query.unreadOnly !== "") {
      if (
        req.query.unreadOnly !== "true" &&
        req.query.unreadOnly !== "false"
      ) {
        return res.status(400).json({
          success: false,
          message: "unreadOnly must be 'true' or 'false'",
        });
      }
      unreadOnly = req.query.unreadOnly === "true";
    }

    let limit = 20;
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
      recipient: req.user._id,
    };
    if (unreadOnly) {
      filter.read = false;
    }

    const [unreadCount, docs] = await Promise.all([
      Notification.countDocuments({
        recipient: req.user._id,
        read: false,
      }),
      Notification.find(filter)
        .select(
          "_id recipient type title message item claim read readAt createdAt"
        )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      success: true,
      unreadCount,
      count: docs.length,
      notifications: docs.map(sanitizeNotification),
    });
  } catch (error) {
    console.error("Fetch notifications error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load notifications",
    });
  }
});

// Mark all unread notifications belonging to the authenticated user as read
router.patch("/read-all", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (Object.keys(body).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Unexpected request body parameters",
      });
    }

    const now = new Date();
    const updateResult = await Notification.updateMany(
      {
        recipient: req.user._id,
        read: false,
      },
      {
        $set: {
          read: true,
          readAt: now,
        },
      }
    );

    return res.json({
      success: true,
      message: "All notifications marked as read",
      modifiedCount: updateResult.modifiedCount || 0,
      unreadCount: 0,
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not mark notifications as read",
    });
  }
});

// Mark a single notification as read (enforces recipient ownership)
router.patch("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (Object.keys(body).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Unexpected request body parameters",
      });
    }

    const notification = await Notification.findOne({
      _id: id,
      recipient: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    if (!notification.read) {
      notification.read = true;
      notification.readAt = new Date();
      await notification.save();
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });

    return res.json({
      success: true,
      message: "Notification marked as read",
      notification: sanitizeNotification(notification),
      unreadCount,
    });
  } catch (error) {
    console.error("Mark notification read error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not update notification",
    });
  }
});

export default router;
