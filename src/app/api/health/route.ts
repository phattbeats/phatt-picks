import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch (err) {
    // Log detail server-side; don't disclose DB internals (file path, connection
    // string fragments) to an unauthenticated caller.
    console.error("[health] db check failed:", err);
    return NextResponse.json(
      { status: "error", db: "unavailable" },
      { status: 503 }
    );
  }
}
