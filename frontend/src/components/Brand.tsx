/**
 * The logo lockup: "The Halfspace" (the second half in brand orange), with
 * "by Abhijith Varma" beneath it. "by" is regular weight, the name semibold.
 * Used in the nav, the footer and anywhere the product is named.
 */
export function Brand({ size = "md" }: { size?: "md" | "nav" | "lg" }) {
  const big = size === "lg";
  const nav = size === "nav";
  return (
    <span className="inline-flex flex-col items-start leading-none">
      <span className={`whitespace-nowrap font-display font-extrabold tracking-[-0.03em] ${big ? "text-[34px]" : nav ? "text-[27px] sm:text-[31px]" : "text-[22px]"}`}>
        The Half<span className="text-warm">space</span>
      </span>
      <span className={`mt-1 font-sans font-normal tracking-[0.02em] text-ink-1 ${big ? "text-[13px]" : nav ? "text-[11.5px] sm:text-[13px]" : "text-[10.5px]"}`}>
        by <span className="font-semibold">Abhijith Varma</span>
      </span>
    </span>
  );
}
