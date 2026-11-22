// ===== Game settings — tweak freely =====
window.GAME_CONFIG = {
  imagesPerCam: 20,                         // images per room: assets/camXX/01.jpg ... 20.jpg
  exts: ['jpg', 'png', 'jpeg', 'webp'],     // extensions tried in this order

  secondsPerHour: 60,       // real seconds per in-game hour
  startHour: 0,             // 0 = 12 AM
  endHour: 6,               // shift ends at 6 AM

  firstAnomalyDelay: 15,    // seconds before the first anomaly
  spawnInterval: [20, 35],  // random seconds between anomalies at start of night
  lateNightSpeedup: 0.55,   // interval multiplier by the end of the night (smaller = faster)

  maxActiveAnomalies: 4,    // this many unreported anomalies at once = game over
  reportProcessTime: 2.0,   // seconds "sending report"
  wrongReportLockout: 3.0,  // seconds you can't report after a wrong report

  minCircleRadius: 0.02,    // fraction of screen height
  maxCircleRadius: 0.35,    // circles bigger than this are rejected (no circling everything)
};

window.CAMERAS = [
  { id: 'cam01', label: 'CAM 01', name: 'In Front of the House' },
  { id: 'cam02', label: 'CAM 02', name: 'Hallway' },
  { id: 'cam03', label: 'CAM 03', name: 'Kitchen' },
  { id: 'cam04', label: 'CAM 04', name: 'Parking Garage' },
  { id: 'cam05', label: 'CAM 05', name: 'Living Room' },
  { id: 'cam06', label: 'CAM 06', name: 'Second Floor Hallway' },
  { id: 'cam07', label: 'CAM 07', name: 'Bedroom' },
  { id: 'cam08', label: 'CAM 08', name: 'Attic' },
  { id: 'cam09', label: 'CAM 09', name: 'Basement' },
  { id: 'cam10', label: 'CAM 10', name: 'Backyard' },
];
