const { formatBytes, generateOutputName, calculateETA } = require('./util');

describe('Utility Functions', () => {
  describe('formatBytes', () => {
    it('formats bytes properly', () => {
      expect(formatBytes(500)).toBe('500B');
      expect(formatBytes(1500)).toBe('1.5KB');
      expect(formatBytes(1500000)).toBe('1.4MB');
    });
  });

  describe('generateOutputName', () => {
    it('appends _converted and changes format', () => {
      expect(generateOutputName('video.mp4', 'mkv')).toBe('video_converted.mkv');
      expect(generateOutputName('my.file.name.avi', 'mp4')).toBe('my.file.name_converted.mp4');
    });
  });

  describe('calculateETA', () => {
    it('shows Calc... for low progress or time', () => {
      expect(calculateETA(0.001, 1500)).toBe('Calc...');
      expect(calculateETA(0.01, 1000)).toBe('Calc...');
    });

    it('calculates properly', () => {
      // 50% done in 5 seconds -> Remaining: 5 seconds
      expect(calculateETA(0.5, 5000)).toBe('0:05');
      // 10% done in 1 minute -> Output should be 9 minutes (540s)
      expect(calculateETA(0.1, 60000)).toBe('9:00');
    });
  });
});
