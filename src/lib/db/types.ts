/** Response contract for `GET /api/health/db`. */
export interface DatabaseHealthResponse {
  success: boolean;
  database: "mongodb";
  status: "connected" | "unavailable" | "not_configured";
}
