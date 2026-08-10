/**
 * The ridge above Alma-Arasan, as a line.
 *
 * One accent, not wallpaper. It sits behind the login card and, much fainter,
 * across the top of the dashboard — decorative only, drawn in a single colour
 * at low opacity so it can never come near the contrast of anything readable
 * on top of it. `aria-hidden` because it says nothing a screen reader needs.
 *
 * Two overlapping outlines rather than one: a nearer, darker ridge and a
 * farther, lighter one, which is what makes it read as depth instead of a
 * zigzag.
 */
export default function MountainRidge({
  className = '',
  fit = 'meet',
}: {
  className?: string
  /**
   * `meet` fits the whole drawing inside the box and letterboxes the rest —
   * right for the login screen, where there is room for all of it.
   *
   * `slice` covers the box and crops instead. The dashboard needs it: the
   * viewBox is 1200×220, so fitting a full-width ridge into a heading strip
   * would demand a fifth of the width in height. Cropping takes the crop off
   * the top, which is sky, and lets the line reach both edges at any height.
   */
  fit?: 'meet' | 'slice'
}) {
  return (
    <svg
      className={`ridge ${className}`}
      viewBox="0 0 1200 220"
      preserveAspectRatio={`xMidYMax ${fit}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* Far range */}
      <path
        className="ridge-far"
        d="M0 178 L92 132 L148 156 L236 96 L318 148 L392 110 L470 160 L556 118
           L642 164 L722 126 L806 168 L888 122 L968 158 L1052 108 L1128 150
           L1200 120 L1200 220 L0 220 Z"
      />
      {/* Near range, with the summit off-centre — a symmetrical mountain
          reads as a logo, not a landscape. */}
      <path
        className="ridge-near"
        d="M0 200 L120 168 L206 188 L300 140 L368 176 L446 128 L520 84
           L596 132 L668 170 L764 142 L846 182 L940 150 L1024 186 L1112 158
           L1200 190 L1200 220 L0 220 Z"
      />
      {/* A single snow line on the highest peak, and nowhere else. */}
      <path className="ridge-snow" d="M494 108 L520 84 L548 110 L528 102 L512 114 Z" />
    </svg>
  )
}
