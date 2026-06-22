import { Coordinates, CalculationMethod, PrayerTimes, Madhab, HighLatitudeRule } from 'adhan';

/**
 * Calculates prayer times for a given location, date, and user settings.
 * @param {number} latitude 
 * @param {number} longitude 
 * @param {Date} date 
 * @param {object} options 
 * @param {string} options.asrMethod - 'standard' (default) or 'hanafi'
 * @param {object} options.prayerOffsets - e.g. { Fajr: 0, Sunrise: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 }
 * @returns {object} formatted times: { Fajr: "HH:mm", Sunrise: "HH:mm", Dhuhr: "HH:mm", Asr: "HH:mm", Maghrib: "HH:mm", Isha: "HH:mm" }
 */
export function calculatePrayerTimes(latitude, longitude, date = new Date(), options = {}) {
  const { 
    asrMethod = 'standard', 
    prayerOffsets = {}, 
    calculationMethod = 'MuslimWorldLeague', 
    highLatitudeRule = 'Auto',
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } = options;

  const coordinates = new Coordinates(latitude, longitude);
  let params;

  // Configure calculation method
  if (calculationMethod === 'LondonUnified') {
    params = CalculationMethod.MoonsightingCommittee();
  } else if (typeof CalculationMethod[calculationMethod] === 'function') {
    params = CalculationMethod[calculationMethod]();
  } else {
    params = CalculationMethod.MuslimWorldLeague();
  }

  // Determine High Latitude Rule
  let rule = highLatitudeRule;
  if (rule === 'Auto') {
    // Default to SeventhOfTheNight above 48 degrees (e.g. UK in summer) to prevent failures
    rule = Math.abs(latitude) > 48 ? 'SeventhOfTheNight' : 'None';
  }

  // Configure High Latitude rule in parameters
  if (calculationMethod === 'LondonUnified') {
    // London Unified standard is TwilightAngle for summer twilight adjustments
    params.highLatitudeRule = HighLatitudeRule.TwilightAngle;
  } else if (rule === 'SeventhOfTheNight') {
    params.highLatitudeRule = HighLatitudeRule.SeventhOfTheNight;
  } else if (rule === 'TwilightAngle') {
    params.highLatitudeRule = HighLatitudeRule.TwilightAngle;
  } else if (rule === 'MiddleOfTheNight') {
    params.highLatitudeRule = HighLatitudeRule.MiddleOfTheNight;
  } else {
    // None / default
    params.highLatitudeRule = HighLatitudeRule.MiddleOfTheNight;
  }

  // Configure Madhab for Asr calculation
  if (asrMethod === 'hanafi') {
    params.madhab = Madhab.Hanafi;
  } else {
    params.madhab = Madhab.Shafi; // Standard (Shafi, Maliki, Hanbali)
  }

  // Calculate base prayer times
  const prayerTimes = new PrayerTimes(coordinates, date, params);

  // Helper to format Date to HH:mm string with local timezone offset applied
  const formatAndAdjust = (time, offsetMinutes = 0) => {
    if (!time) return '';
    // Apply manual minute offset
    const adjustedTime = new Date(time.getTime() + offsetMinutes * 60000);
    
    // Format based on the requested timezone
    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timeZone
    });
    return formatter.format(adjustedTime);
  };

  return {
    Fajr: formatAndAdjust(prayerTimes.fajr, prayerOffsets.Fajr || 0),
    Sunrise: formatAndAdjust(prayerTimes.sunrise, prayerOffsets.Sunrise || 0),
    Dhuhr: formatAndAdjust(prayerTimes.dhuhr, prayerOffsets.Dhuhr || 0),
    Asr: formatAndAdjust(prayerTimes.asr, prayerOffsets.Asr || 0),
    Maghrib: formatAndAdjust(prayerTimes.maghrib, prayerOffsets.Maghrib || 0),
    Isha: formatAndAdjust(prayerTimes.isha, prayerOffsets.Isha || 0),
  };
}
