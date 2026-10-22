import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      enum: [
        "CLAIM_SUBMITTED",
        "CLAIM_APPROVED",
        "CLAIM_REJECTED",
        "ITEM_RETURNED",
        "REPORT_MODERATED",
      ],
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    // Public-safe notification text. Never store private claim proofDescription
    // or sensitive reviewer notes inside notification messages.
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      default: null,
    },

    claim: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Claim",
      default: null,
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 200,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
