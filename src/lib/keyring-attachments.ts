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

export const CHARM_ATTACHMENTS: Record<string, CharmAttachment> = {
  // C4 plush: upper split-ring, centred over the bundle.
  c4_plush: { x: 0.5, y: 0.16 },
  // Defuse kit: top-left split-ring above the cutter head.
  defuse_kit: { x: 0.22, y: 0.15 },
};
