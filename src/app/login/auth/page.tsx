import { redirect } from "next/navigation";

/**
 * Legacy sign-in route. Sign-in is now merged into the `/login` splash
 * (HANDOFF §5e); this keeps old links and auth-callback redirects
 * (`/login/auth?error=…`) working by forwarding every query param.
 */
export default async function LegacyAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else if (value !== undefined) qs.append(key, value);
  }
  const query = qs.toString();
  redirect(query ? `/login?${query}` : "/login");
}
