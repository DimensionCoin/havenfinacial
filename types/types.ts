// types/types.ts

import type {
  Idl,
  IdlAccounts,
  ProgramAccount,
  IdlTypes,
} from "@coral-xyz/anchor";
import type { Perpetuals as RawPerpetuals } from "../idl/jupiter-perpetuals-idl";

/**
 * Make the generated Perpetuals IDL type satisfy Anchor's `Idl` constraint.
 *
 * We *don't* try to re-declare `metadata` or `address` ourselves.
 * Instead, we just intersect it with Anchor's `Idl` type, which already
 * has those fields with the correct types.
 *
 * This is purely a TypeScript type trick — it doesn't change the runtime IDL object.
 */
export type PerpetualsIdl = Idl & RawPerpetuals;

// ----------------- Account type aliases -----------------

export type BorrowPosition = IdlAccounts<PerpetualsIdl>["borrowPosition"];

export type Position = IdlAccounts<PerpetualsIdl>["position"];
export type PositionAccount = ProgramAccount<Position>;

export type PositionRequest = IdlAccounts<PerpetualsIdl>["positionRequest"];
export type PositionRequestAccount = ProgramAccount<PositionRequest>;

export type Custody = IdlAccounts<PerpetualsIdl>["custody"];
export type CustodyAccount = ProgramAccount<Custody>;

export type Pool = IdlAccounts<PerpetualsIdl>["pool"];

// ----------------- Other IDL-defined types -----------------

export type ContractTypes = IdlTypes<PerpetualsIdl>;
export type PoolApr = ContractTypes["PoolApr"];
export type OraclePrice = ContractTypes["OraclePrice"];
