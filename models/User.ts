// models/User.ts
import mongoose, {
  Schema,
  models,
  model,
  type InferSchemaType,
  type Model,
} from "mongoose";

/** ---------- Subtypes ---------- */

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string; // ISO-3166 alpha-2
};

const AddressSchema = new Schema<Address>(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, required: true, trim: true },
    stateOrProvince: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
    },
  },
  { _id: false }
);

type ConsentType = "tos" | "privacy" | "risk" | "savings";

type Consent = {
  type: ConsentType;
  version: string;
  acceptedAt: Date;
};

const ConsentSchema = new Schema<Consent>(
  {
    type: {
      type: String,
      required: true,
      enum: ["tos", "privacy", "risk", "savings"],
    },
    version: { type: String, required: true },
    acceptedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

type EmbeddedWallet = {
  walletId?: string; // Privy wallet id
  address?: string; // base58 (Solana)
  chainType: "solana";
};

const EmbeddedWalletSchema = new Schema<EmbeddedWallet>(
  {
    walletId: { type: String },
    address: { type: String },
    chainType: { type: String, enum: ["solana"], default: "solana" },
  },
  { _id: false }
);

/** ---------- Marginfi + token account caches (no savings wallet/ATA) ---------- */

type MarginfiMeta = {
  accountPk?: string; // Marginfi account (PDA)
  usdcBankPk?: string; // cached bank
  lastApy?: number;
  lastApyAt?: Date;
};

const MarginfiMetaSchema = new Schema<MarginfiMeta>(
  {
    accountPk: { type: String },
    usdcBankPk: { type: String },
    lastApy: { type: Number },
    lastApyAt: { type: Date },
  },
  { _id: false }
);

type TokenAccounts = {
  usdc2022?: {
    /** ATA on the single (deposit) wallet */
    depositAta?: string;
  };
};

const TokenAccountsSchema = new Schema<TokenAccounts>(
  {
    usdc2022: {
      depositAta: { type: String },
    },
  },
  { _id: false }
);

/** ---------- Main schema ---------- */

const UserSchema = new Schema(
  {
    privyId: { type: String, required: true, unique: true, index: true },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },

    countryISO: {
      type: String,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
      index: true,
    },
    displayCurrency: {
      type: String,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: "USD",
    },

    address: { type: AddressSchema, select: false },
    dob: { type: Date, select: false },
    phoneNumber: { type: String, select: false },

    status: {
      type: String,
      enum: ["pending", "active", "blocked", "closed"],
      default: "pending",
      index: true,
    },
    kycStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
      index: true,
    },

    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    riskLevelUpdatedAt: { type: Date },

    features: {
      onramp: { type: Boolean, default: false },
      cards: { type: Boolean, default: false },
      lend: { type: Boolean, default: false },
    },

    /** Single wallet (also the marginfi authority) */
    depositWallet: { type: EmbeddedWalletSchema, required: false },

    /** Token accounts (no savingsAta now) */
    tokenAccounts: { type: TokenAccountsSchema, default: {} },

    /** Marginfi linkage */
    marginfi: { type: MarginfiMetaSchema, default: {} },

    /** Keep for terms gating */
    savingsConsent: {
      enabled: { type: Boolean, default: false },
      acceptedAt: { type: Date },
      version: { type: String, default: "" },
    },

    displayName: { type: String, trim: true },

    consents: { type: [ConsentSchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, any>) {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(_doc, ret: Record<string, any>) {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

/** Helpful indexes */
UserSchema.index({ "depositWallet.address": 1 });
UserSchema.index({ "marginfi.accountPk": 1 });

/** Email normalization guard */
UserSchema.pre("save", function (next) {
  if (this.isModified("email") && typeof (this as any).email === "string") {
    (this as any).email = (this as any).email.trim().toLowerCase();
  }
  next();
});

/** ---------- Types, Model & Statics ---------- */
export type IUser = InferSchemaType<typeof UserSchema>;

interface IUserModel extends Model<IUser> {
  findOrCreateByPrivy(input: {
    privyId: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }): Promise<IUser>;
}

UserSchema.statics.findOrCreateByPrivy = async function ({
  privyId,
  email,
  firstName,
  lastName,
}: {
  privyId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<IUser> {
  // Try authoritative key first
  let user = await this.findOne({ privyId });

  // Fallback by email to merge legacy users
  if (!user) {
    user = await this.findOne({ email: email.toLowerCase().trim() });
  }

  if (!user) {
    user = await this.create({
      privyId,
      email,
      firstName,
      lastName,
      status: "pending",
      kycStatus: "none",
      features: { onramp: false, cards: false, lend: false },
      consents: [],
      tokenAccounts: {},
      marginfi: {},
    });
    return user;
  }

  // Non-destructive updates
  const maybeEmail = email?.toLowerCase().trim();
  if (maybeEmail && user.email !== maybeEmail) user.email = maybeEmail;
  if (firstName && !user.firstName) user.firstName = firstName;
  if (lastName && !user.lastName) user.lastName = lastName;

  await user.save();
  return user;
};

const User =
  (models.User as IUserModel) || model<IUser, IUserModel>("User", UserSchema);

export default User;
