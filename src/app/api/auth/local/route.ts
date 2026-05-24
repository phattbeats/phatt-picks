/**
 * Local player session creation.
 * Creates an anonymous local player with a generated name, issues session JWT.
 */

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

function getSessionSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return new TextEncoder().encode(secret);
}

const ADJECTIVES = ["Tactical", "Clutch", "Raging", "Silent", "Atomic", "Phantom", "Steel", "Iron"];
const NOUNS = ["Awper", "Rusher", "Lurker", "Baiter", "Caller", "Fragger", "Entry", "Support"];

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 999);
  return `${adj}${noun}${num}`;
}

export async function GET() {
  try {
    const inviteCode = randomBytes(6).toString("hex");
    const displayName = randomName();

    const player = await prisma.player.create({
      data: { displayName, isLocal: true, inviteCode },
    });

    const token = await new SignJWT({ sub: player.id, displayName, isLocal: true })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(getSessionSecret());

    const response = NextResponse.redirect(new URL("/", BASE_URL));
    response.cookies.set("phatt_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (err) {
    console.error("Local player creation error:", err);
    return NextResponse.redirect(new URL("/login?error=local_create_failed", BASE_URL));
  }
}
