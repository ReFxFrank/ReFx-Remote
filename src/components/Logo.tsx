/** ReFx brand marks (from the official asset set). */

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/refx-icon.png"
      alt="ReFx"
      width={size}
      height={size}
      className={`rounded-md ${className}`}
      draggable={false}
    />
  );
}

export function LogoWordmark({ height = 22, className = "" }: { height?: number; className?: string }) {
  // Source banner is 4096×832 (~4.92:1).
  const width = Math.round((height * 4096) / 832);
  return (
    <img
      src="/brand/refx-wordmark.png"
      alt="ReFx"
      width={width}
      height={height}
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
