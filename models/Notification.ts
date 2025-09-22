// models/Notification.ts
import mongoose, { Schema, Types } from "mongoose";
import type { NotificationType } from "@/types/notifications";

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  message: string;
  type: NotificationType;
  data?: Record<string, unknown>;
  seen: boolean;
  seenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["generic", "transfer_received", "transfer_sent", "system"],
      default: "generic",
    },
    data: { type: Schema.Types.Mixed },
    seen: { type: Boolean, default: false, index: true },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default (mongoose.models
  .Notification as mongoose.Model<INotification>) ??
  mongoose.model<INotification>("Notification", NotificationSchema);
