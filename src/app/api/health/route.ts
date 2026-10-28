import { NextResponse } from "next/server";

import { environment } from "@/config/environment";

export const dynamic = "force-dynamic";

interface AppHealthResponse {
  success: boolean;
  service: string;
  status: "ok";
  environment: "production" | "development";
  uptimeSeconds: number;
  timestamp: string;
}

export async function GET(): Promise<NextResponse<AppHealthResponse>> {
  return NextResponse.json<AppHealthResponse>(
    {
      success: true,
      service: "healthcare-management-platform",
      status: "ok",
      environment: environment.isProduction ? "production" : "development",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
