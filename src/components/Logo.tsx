/** ReFx brand marks (from the official asset set). */

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  // The transparent blue "R" mark — sits cleanly on the dark UI, no backdrop.
  // Explicit inline size so Tailwind's preflight (`img { height: auto }`)
  // can't collapse it.
  return (
    <img
      src="/brand/refx-r.png"
      alt="ReFx"
      style={{ width: size, height: size, objectFit: "contain" }}
      className={className}
      draggable={false}
    />
  );
}

export function LogoWordmark({ height = 22, className = "" }: { height?: number; className?: string }) {
  // Source banner is 4096×832 (~4.92:1).
  return (
    <img
      src="/brand/refx-wordmark.png"
      alt="ReFx"
      style={{ height, width: "auto", objectFit: "contain" }}
      className={className}
      draggable={false}
    />
  );
}

/** Ambient aurora backdrop — fixed behind all content. */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="refx-aurora refx-aurora-a" />
      <div className="refx-aurora refx-aurora-b" />
      <div className="refx-aurora refx-aurora-c" />
    </div>
  );
}
