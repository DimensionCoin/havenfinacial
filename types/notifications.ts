// types/notifications.ts
import { z } from "zod";

export const NOTIFICATION_TYPES = [
  "generic",
  "transfer_received",
  "transfer_sent",
  "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ZCreateNotification = z.object({
  message: z.string().min(1).max(1_000),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  data: z.record(z.unknown()).optional(),
});

export const ZListNotificationsQuery = z.object({
  unseen: z.enum(["0", "1", "true", "false"]).optional(),
  limit: z
    .preprocess(
      (v) => (v == null ? undefined : Number(v)),
      z.number().int().min(1).max(200)
    )
    .optional(),
});
