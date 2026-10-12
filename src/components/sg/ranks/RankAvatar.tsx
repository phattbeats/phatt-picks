import Image from "next/image";

/** Square 4px avatar / monogram used across the ranks screens (.av). */
export function RankAvatar({
  name,
  avatarUrl,
  size = 30,
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
}) {
  return (
    <span className="av rk-av" style={{ width: size, height: size }} aria-hidden>
      {avatarUrl ? (
        <Image src={avatarUrl} alt="" width={size} height={size} unoptimized />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
