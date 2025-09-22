import "server-only";
import mongoose from "mongoose";

const MONGODB_URL = process.env.MONGODB_URL!;
if (!MONGODB_URL) throw new Error("Missing MONGODB_URL");

declare global {
  // allow global cache in dev to avoid hot-reload storms
  var __mongoose: Promise<typeof mongoose> | undefined;
}

export async function connect() {
  if (!global.__mongoose) {
    mongoose.set("strictQuery", true);
    global.__mongoose = mongoose.connect(MONGODB_URL /*, { dbName: "haven" }*/);
  }
  return global.__mongoose;
}
