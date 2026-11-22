/**
 * Where each charm's metal attachment loop sits in its square artwork.
 * These coordinates are shared by the server profile assembler and the client
 * animator; the physics point represents this hardware, never the art centre.
 */
export interface CharmAttachment {
  /** Fraction of the artwork width, from its left edge. */
  x: number;
  /** Fraction of the artwork height, from its top edge. */
  y: number;
}

export const DEFAULT_CHARM_ATTACHMENT: CharmAttachment = { x: 0.5, y: 0.5 };

/**
 * Measured from the posters themselves (PHA-5297): each value is the top arc of
 * the metal split ring, i.e. where a thread would physically hook on, in
 * fractions of the 480x480 artwork.
 *
 * - c4-plush.webp: the ring is the desaturated circle spanning x 186-292,
 *   y 32-132; its top arc sits at x 220-259 on y 32. Anchor: (239, 32).
 * - defuse-kit.webp: the ring is the desaturated ellipse spanning x 67-240,
 *   y 21-178; its top arc sits at x 178-198 on y 21. Anchor: (190, 21).
 *
 * The earlier values (0.5, 0.16) and (0.22, 0.15) landed inside the ring's
 * hollow or on its wall, which is why the thread appeared to attach to the
 * model instead of the metal.
 */
export const CHARM_ATTACHMENTS: Record<string, CharmAttachment> = {
  // C4 plush: top of the split ring above the plush bundle.
  c4_plush: { x: 239 / 480, y: 32 / 480 },
  // Defuse kit: top of the split ring above the cutter head.
  defuse_kit: { x: 190 / 480, y: 21 / 480 },
};
