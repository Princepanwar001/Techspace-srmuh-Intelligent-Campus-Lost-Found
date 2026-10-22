import mongoose from "mongoose";
import Notification from "../models/Notification.js";

// Create a notification idempotently using a unique idempotencyKey.
// Retried or concurrent events with the same idempotencyKey never create duplicate notifications.
export async function createNotificationIfNotExists({
  recipientId,
  type,
  title,
  message,
  idempotencyKey,
  itemId = null,
  claimId = null,
}) {
  if (
    !recipientId ||
    !mongoose.isValidObjectId(recipientId) ||
    !type ||
    !title ||
    !message ||
    !idempotencyKey
  ) {
    return { created: false, notification: null };
  }

  try {
    const notification = await Notification.create({
      recipient: recipientId,
      type,
      title: String(title).trim().slice(0, 120),
      message: String(message).trim().slice(0, 300),
      idempotencyKey: String(idempotencyKey).trim().slice(0, 200),
      item: itemId && mongoose.isValidObjectId(itemId) ? itemId : null,
      claim: claimId && mongoose.isValidObjectId(claimId) ? claimId : null,
      read: false,
      readAt: null,
    });

    return { created: true, notification };
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Notification.findOne({ idempotencyKey });
      return { created: false, notification: existing };
    }
    throw error;
  }
}

// Notify the finder/owner of a FOUND report when a claim is submitted.
// Never includes private claim proofDescription in the notification text.
export async function notifyClaimSubmitted({ item, claim }) {
  if (!item || !item._id || !claim || !claim._id || !item.reportedBy) {
    return { created: false, notification: null };
  }

  const recipientIdStr = (item.reportedBy._id || item.reportedBy).toString();
  const claimantIdStr = claim.claimant
    ? (claim.claimant._id || claim.claimant).toString()
    : "";

  if (!recipientIdStr || recipientIdStr === claimantIdStr) {
    return { created: false, notification: null };
  }

  const safeTitle =
    typeof item.title === "string" ? item.title.trim().slice(0, 60) : "item";

  return createNotificationIfNotExists({
    recipientId: recipientIdStr,
    type: "CLAIM_SUBMITTED",
    title: "New claim on your found report",
    message: `A community member submitted an ownership claim for "${safeTitle}". Open Claims to review it.`,
    idempotencyKey: `notif:claim_submitted:${claim._id.toString()}:${recipientIdStr}`,
    itemId: item._id,
    claimId: claim._id,
  });
}

// Notify participants when a claim is APPROVED or REJECTED.
// Never exposes private proofDescription or private reviewNote in notification messages.
export async function notifyClaimReviewed({ item, claim, decision }) {
  if (!item || !item._id || !claim || !claim._id) {
    return { claimantNotification: null, finderNotification: null };
  }

  const claimantIdStr = claim.claimant
    ? (claim.claimant._id || claim.claimant).toString()
    : "";
  const finderIdStr = item.reportedBy
    ? (item.reportedBy._id || item.reportedBy).toString()
    : "";
  const safeTitle =
    typeof item.title === "string" ? item.title.trim().slice(0, 60) : "item";

  let claimantNotification = null;
  let finderNotification = null;

  if (decision === "APPROVED") {
    if (claimantIdStr && mongoose.isValidObjectId(claimantIdStr)) {
      claimantNotification = await createNotificationIfNotExists({
        recipientId: claimantIdStr,
        type: "CLAIM_APPROVED",
        title: "Your ownership claim was approved!",
        message: `Your claim for "${safeTitle}" was verified and approved, and the report is now marked as RETURNED.`,
        idempotencyKey: `notif:claim_approved:${claim._id.toString()}:${claimantIdStr}`,
        itemId: item._id,
        claimId: claim._id,
      });
    }

    if (
      finderIdStr &&
      mongoose.isValidObjectId(finderIdStr) &&
      finderIdStr !== claimantIdStr
    ) {
      finderNotification = await createNotificationIfNotExists({
        recipientId: finderIdStr,
        type: "ITEM_RETURNED",
        title: "Verified item return completed",
        message: `Your found report "${safeTitle}" was verified as RETURNED to its rightful owner.`,
        idempotencyKey: `notif:item_returned:${item._id.toString()}:${finderIdStr}`,
        itemId: item._id,
        claimId: claim._id,
      });
    }
  } else if (decision === "REJECTED") {
    if (claimantIdStr && mongoose.isValidObjectId(claimantIdStr)) {
      claimantNotification = await createNotificationIfNotExists({
        recipientId: claimantIdStr,
        type: "CLAIM_REJECTED",
        title: "Update on your ownership claim",
        message: `Your ownership claim for "${safeTitle}" was not approved during review.`,
        idempotencyKey: `notif:claim_rejected:${claim._id.toString()}:${claimantIdStr}`,
        itemId: item._id,
        claimId: claim._id,
      });
    }
  }

  return { claimantNotification, finderNotification };
}

// Notify the report owner when an administrator moderates/removes their report.
export async function notifyReportModerated({ item }) {
  if (!item || !item._id || !item.reportedBy) {
    return { created: false, notification: null };
  }

  const recipientIdStr = (item.reportedBy._id || item.reportedBy).toString();
  if (!recipientIdStr || !mongoose.isValidObjectId(recipientIdStr)) {
    return { created: false, notification: null };
  }

  const safeTitle =
    typeof item.title === "string" ? item.title.trim().slice(0, 60) : "report";

  return createNotificationIfNotExists({
    recipientId: recipientIdStr,
    type: "REPORT_MODERATED",
    title: "Your campus report was moderated",
    message: `Your report "${safeTitle}" was closed and removed from public listing by campus moderation.`,
    idempotencyKey: `notif:report_moderated:${item._id.toString()}:${recipientIdStr}`,
    itemId: item._id,
  });
}
