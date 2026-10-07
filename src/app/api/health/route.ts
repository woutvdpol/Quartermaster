import { connection } from "next/server";

/**
 * Liveness probe. Answers as long as the Node.js process can serve requests;
 * deliberately does not touch the database so a DB outage never restarts pods.
 */
export async function GET() {
  // Opt into request-time rendering (works with and without Cache Components).
  await connection();

  return Response.json(
    { status: "ok", uptime: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
