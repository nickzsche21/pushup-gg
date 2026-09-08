import { tierFor, tierProgress } from "@/lib/ranks";

export function RankBadge({ rating, size = "md" }: { rating: number; size?: "sm" | "md" | "lg" }) {
  const t = tierFor(rating);
  const px = size === "lg" ? 15 : size === "sm" ? 10 : 12;
  return (
    <span
      className="display inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 leading-none"
      style={{
        fontSize: px,
        color: t.color,
        background: `${t.color}18`,
        border: `1px solid ${t.color}44`,
        letterSpacing: "0.06em",
      }}
    >
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2l3.1 6.5 7 1-5 5 1.2 7L12 18.2 5.7 21.5l1.2-7-5-5 7-1L12 2z" fill={t.color} />
      </svg>
      {t.name}
    </span>
  );
}

export function RankMeter({ rating }: { rating: number }) {
  const t = tierFor(rating);
  const p = tierProgress(rating);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <RankBadge rating={rating} />
        <span className="display tabular text-2xl" style={{ color: t.color }}>
          {rating}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${Math.round(p * 100)}%`, background: t.color, boxShadow: `0 0 12px ${t.glow}` }}
        />
      </div>
    </div>
  );
}
