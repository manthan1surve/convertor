function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

function generateOutputName(filename, format) {
  return filename.replace(/\.[^.]+$/, '_converted.') + format;
}

function calculateETA(progressPct, elapsedMs) {
  if (progressPct <= 0.005 || elapsedMs <= 2000) return 'Calc...';
  const remainingMs = (elapsedMs / progressPct) - elapsedMs;
  if (remainingMs <= 0) return '0:00';
  const rSecs = Math.round(remainingMs / 1000);
  const h = Math.floor(rSecs / 3600);
  const m = Math.floor((rSecs % 3600) / 60);
  const s = rSecs % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = { formatBytes, generateOutputName, calculateETA };
