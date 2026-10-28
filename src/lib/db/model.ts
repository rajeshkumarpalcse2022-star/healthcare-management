import "server-only";

import mongoose, { type Model, type Schema } from "mongoose";

/**
 * Registers a model exactly once.
 *
 * During development Next.js re-evaluates modules on every reload, and calling
 * `mongoose.model("X", schema)` twice throws `OverwriteModelError`. Checking
 * `mongoose.models` first makes schemas idempotent.
 *
 * Usage (in a server-only module):
 *   export const User = getModel("User", userSchema);
 */
export function getModel<T>(name: string, schema: Schema<T>): Model<T> {
  const registered = mongoose.models[name];

  if (registered) {
    return registered as unknown as Model<T>;
  }

  return mongoose.model<T>(name, schema);
}
