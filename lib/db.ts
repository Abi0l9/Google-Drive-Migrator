import mongoose from "mongoose";
import { env } from "@/lib/env";

declare global {
  var mongooseConnection: Promise<typeof mongoose> | undefined;
}

export function connectDb() {
  if (!global.mongooseConnection) {
    global.mongooseConnection = mongoose.connect(env.mongoUri).catch((error) => {
      global.mongooseConnection = undefined;
      throw error;
    });
  }
  return global.mongooseConnection;
}
