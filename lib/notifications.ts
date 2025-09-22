// lib/notifications.ts
import "server-only";
import { Types, type FilterQuery } from "mongoose";
import { connect } from "@/lib/db";
import Notification, { type INotification } from "@/models/Notification";
import User from "@/models/User";
import type { NotificationType } from "@/types/notifications";

/** Core create */
export async function createNotification(opts: {
  userId: string | Types.ObjectId;
  message: string;
  type?: NotificationType;
  data?: Record<string, unknown>;
}): Promise<INotification> {
  await connect();
  const n = await Notification.create({
    userId: new Types.ObjectId(String(opts.userId)),
    message: opts.message,
    type: opts.type ?? "generic",
    data: opts.data,
  });
  return n.toObject() as INotification;
}

/** List for a user */
export async function listNotificationsForUser(opts: {
  userId: string | Types.ObjectId;
  unseenOnly?: boolean;
  limit?: number;
}): Promise<INotification[]> {
  await connect();
  const q: FilterQuery<INotification> = {
    userId: new Types.ObjectId(String(opts.userId)),
  };
  if (opts.unseenOnly) q.seen = false;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  return (await Notification.find(q)
    .sort({ seen: 1, createdAt: -1 })
    .limit(limit)
    .lean()) as INotification[];
}

/** Mark seen */
export async function markNotificationsSeen(opts: {
  userId: string | Types.ObjectId;
  ids?: (string | Types.ObjectId)[];
  all?: boolean;
}): Promise<{ matched: number; modified: number }> {
  await connect();
  const userId = new Types.ObjectId(String(opts.userId));
  const filter: FilterQuery<INotification> = { userId, seen: false };
  if (!opts.all) {
    const ids = (opts.ids ?? []).map((id) => new Types.ObjectId(String(id)));
    if (ids.length === 0) return { matched: 0, modified: 0 };
    filter._id = { $in: ids };
  }
  const res = await Notification.updateMany(filter, {
    $set: { seen: true, seenAt: new Date() },
  });
  type UpdateCounts = {
    matchedCount?: number;
    modifiedCount?: number;
    n?: number;
    nModified?: number;
  };
  const counts = res as UpdateCounts;
  return {
    matched: counts.matchedCount ?? counts.n ?? 0,
    modified: counts.modifiedCount ?? counts.nModified ?? 0,
  };
}

/** Convenience: resolve a target then create */
export async function createNotificationForTarget(opts: {
  userId?: string;
  email?: string;
  owner58?: string; // if you store depositWallet.owner (base58) on User
  message: string;
  type?: NotificationType;
  data?: Record<string, unknown>;
}): Promise<INotification | null> {
  await connect();

  let userId: string | null = null;
  if (opts.userId) {
    userId = opts.userId;
  } else if (opts.email) {
    const u = await User.findOne({ email: opts.email }).select("_id").lean();
    userId = u ? String(u._id) : null;
  } else if (opts.owner58) {
    const u = await User.findOne({ "depositWallet.address": opts.owner58 })
      .select("_id")
      .lean();
    userId = u ? String(u._id) : null;
  }

  if (!userId) return null;

  return await createNotification({
    userId,
    message: opts.message,
    type: opts.type ?? "generic",
    data: opts.data,
  });
}
