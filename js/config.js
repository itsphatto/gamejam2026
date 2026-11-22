// ===== Game settings — tweak freely =====
window.GAME_CONFIG = {
  imagesPerCam: 20,                         // images per room: assets/camXX/01.jpg ... 20.jpg
  exts: ['jpg', 'png', 'jpeg', 'webp'],     // extensions tried in this order

  secondsPerHour: 35,       // real seconds per in-game hour (6 h x 35 s = 3.5 min shift)
  startHour: 0,             // 0 = 12 AM
  endHour: 6,               // shift ends at 6 AM

  firstAnomalyDelay: 15,    // seconds before the first anomaly
  spawnInterval: [20, 35],  // random seconds between anomalies at start of night
  lateNightSpeedup: 0.55,   // interval multiplier by the end of the night (smaller = faster)

  anomalyTimeLimit: 21,     // seconds to report an anomaly before the jumpscare (= game over)
  shakeStart: 12,           // seconds after an anomaly appears: screen starts shaking
  shakeHard: 18,            // seconds after an anomaly appears: screen shakes hard
  reportProcessTime: 2.0,   // seconds "sending report"
  wrongReportLockout: 3.0,  // seconds you can't report after a wrong report
};

window.CAMERAS = [
  { id: 'cam01', label: 'CAM 01', name: 'หน้าบ้าน' },
  { id: 'cam02', label: 'CAM 02', name: 'ทางเดินชั้นล่าง' },
  { id: 'cam03', label: 'CAM 03', name: 'ห้องครัว' },
  { id: 'cam04', label: 'CAM 04', name: 'โรงจอดรถ' },
  { id: 'cam05', label: 'CAM 05', name: 'ห้องนั่งเล่น' },
  { id: 'cam06', label: 'CAM 06', name: 'ทางเดินชั้นสอง' },
  { id: 'cam07', label: 'CAM 07', name: 'ห้องนอน' },
  { id: 'cam08', label: 'CAM 08', name: 'ห้องใต้หลังคา' },
  { id: 'cam09', label: 'CAM 09', name: 'ห้องใต้ดิน' },
  { id: 'cam10', label: 'CAM 10', name: 'สวนหลังบ้าน' },
];
