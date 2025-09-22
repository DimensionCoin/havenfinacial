// models/EmailClaim.ts
import mongoose, { Schema, models, model } from "mongoose";

export type EmailClaimStatus = "pending" | "claimed" | "canceled" | "expired";

const EmailClaimSchema = new Schema(
  {
    senderUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    senderFromOwner: { type: String, required: true }, // sender's token owner (pubkey)
    recipientEmail: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    amountUnits: { type: Number, required: true }, // USDC 6dp
    currency: { type: String, default: "USDC" },

    // escrow leg (sender → escrow)
    escrowSignature: { type: String },
    escrowWalletAddress: { type: String },

    // claim leg (escrow → recipient)
    status: {
      type: String,
      enum: ["pending", "claimed", "canceled", "expired"],
      default: "pending",
      index: true,
    },
    claimedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    claimSignature: { type: String },
    claimedAt: { type: Date },

    // email + UX
    note: { type: String },

    // token binding
    tokenId: { type: String, required: true, unique: true, index: true },
    tokenExpiresAt: { type: Date, required: true },

    // idempotency (retries from client)
    idempotencyKey: { type: String, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: any) {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

export type IEmailClaim = mongoose.InferSchemaType<typeof EmailClaimSchema>;
export default (models.EmailClaim as mongoose.Model<IEmailClaim>) ||
  model<IEmailClaim>("EmailClaim", EmailClaimSchema);
