import type { Country } from "@/lib/team-stats-core";

interface FlagProps {
  country: Country | null | undefined;
  className?: string;
}

/**
 * Small self-hosted flag (PHA-5255): /flags/<cc>.webp, or the globe mark for
 * HLTV's regional codes (NAM / SAM / WORLD). Renders nothing without a flag, so
 * it's safe next to any team or player name. Decorative to screen readers when
 * the name beside it already says who it is; the title carries the country.
 */
export function Flag({ country, className }: FlagProps) {
  if (!country?.flag) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 16px static asset, no optimiser needed
    <img
      className={`flag-img${className ? ` ${className}` : ""}`}
      src={country.flag}
      alt={country.name}
      title={country.name}
      width={16}
      height={12}
      loading="lazy"
      decoding="async"
    />
  );
}
