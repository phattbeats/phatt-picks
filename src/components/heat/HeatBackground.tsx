/** Atmosphere layers used app-wide: heat blobs, map grid, scanlines, vignette. */
export function HeatBackground() {
  return (
    <>
      <div className="heat-bg" aria-hidden />
      <div className="map-grid" aria-hidden />
      <div className="scanlines" aria-hidden />
      <div className="vignette" aria-hidden />
    </>
  );
}
