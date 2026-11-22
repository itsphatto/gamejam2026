// Anomaly map — generate this file with editor.html (Export -> Download), then replace it.
//
// Format per camera:
//   { num: "01", anomaly: null }                               -> normal image
//   { num: "02", anomaly: { x: 0.52, y: 0.41, r: 0.06 } }      -> anomaly image
//     x, y = anomaly centre (0..1 of image width / height)
//     r    = radius (fraction of image width)
//
// Cameras missing from this object default to 01..20, all normal.
// If NO anomaly is defined anywhere, the game runs in DEMO MODE with placeholder anomalies.
window.ANOMALY_DATA = {};
