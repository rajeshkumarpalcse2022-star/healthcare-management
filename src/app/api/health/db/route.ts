import { NextResponse } from "next/server";

import { environment } from "@/config/environment";
import { pingDatabase, type DatabaseHealthResponse } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<NextResponse<DatabaseHealthResponse>> {
  if (!environment.mongodb.isConfigured) {
    return NextResponse.json<DatabaseHealthResponse>(
      { success: false, database: "mongodb", status: "not_configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    await pingDatabase();
    return NextResponse.json<DatabaseHealthResponse>(
      { success: true, database: "mongodb", status: "connected" },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Logged server-side only; the response stays generic on purpose.
    console.error(
      "[api/health/db] check failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json<DatabaseHealthResponse>(
      { success: false, database: "mongodb", status: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
