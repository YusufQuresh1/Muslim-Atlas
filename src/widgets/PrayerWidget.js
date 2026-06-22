import React from 'react';
import { FlexWidget, TextWidget, SvgWidget } from 'react-native-android-widget';

// Inline vector SVG map pin icon identical to location-sharp from Ionicons
const locationPinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#cbd5e1" width="10" height="10">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
</svg>
`;

// Inline vector SVG sun icon matching sunny-outline from Ionicons
const sunIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="#ffffff" width="10" height="10">
  <path d="M256 160c-52.9 0-96 43.1-96 96s43.1 96 96 96 96-43.1 96-96-43.1-96-96-96zm0 256c-88.4 0-160-71.6-160-160S167.6 96 256 96s160 71.6 160 160-71.6 160-160 160zm0-384c13.3 0 24-10.7 24-24V24c0-13.3-10.7-24-24-24s-24 10.7-24 24v8c0 13.3 10.7 24 24 24zm0 432c-13.3 0-24 10.7-24 24v8c0 13.3 10.7 24 24 24s24-10.7 24-24v-8c0-13.3-10.7-24-24-24zm181-309c9.4-9.4 9.4-24.6 0-33.9l-5.7-5.7c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l5.7 5.7c9.3 9.4 24.5 9.4 33.9 0zM114.9 397.1c-9.4-9.4-24.6-9.4-33.9 0l-5.7 5.7c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l5.7-5.7c9.4-9.3 9.4-24.5 0-33.9zm303 33.9c9.4 9.4 24.6 9.4 33.9 0l5.7-5.7c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-5.7 5.7c-9.4 9.3-9.4 24.5 0 33.9zM114.9 114.9c9.4 9.4 24.6 9.4 33.9 0l5.7-5.7c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-5.7 5.7c-9.4 9.3-9.4 24.5 0 33.9zM488 232h-8c-13.3 0-24 10.7-24 24s10.7 24 24 24h8c13.3 0 24-10.7 24-24s-10.7-24-24-24zM56 232H48c-13.3 0-24 10.7-24 24s10.7 24 24 24h8c13.3 0 24-10.7 24-24s-10.7-24-24-24z"/>
</svg>
`;

export function PrayerWidget({ prayerTimes, nextPrayerName, currentPrayerName, locationName = 'Current Location' }) {
  // Only the 5 daily prayers in the grid, matching the home screen card
  const prayers = [
    { name: 'Fajr', time: prayerTimes.Fajr },
    { name: 'Dhuhr', time: prayerTimes.Dhuhr },
    { name: 'Asr', time: prayerTimes.Asr },
    { name: 'Maghrib', time: prayerTimes.Maghrib },
    { name: 'Isha', time: prayerTimes.Isha },
  ];

  // Dynamic Gregorian Date
  const now = new Date();
  const gregorianStr = now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  
  // Dynamic Hijri Date using native Intl
  let hijriStr = '';
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    hijriStr = formatter.format(now);
    hijriStr = hijriStr.replace(' AH', '') + ' AH';
  } catch (e) {
    hijriStr = '';
  }

  const dateLine = hijriStr ? `${gregorianStr}  •  ${hijriStr}` : gregorianStr;

  // Next prayer time helper (covers all 6 items including Sunrise for next calculation)
  const fullPrayers = [
    { name: 'Fajr', time: prayerTimes.Fajr },
    { name: 'Sunrise', time: prayerTimes.Sunrise },
    { name: 'Dhuhr', time: prayerTimes.Dhuhr },
    { name: 'Asr', time: prayerTimes.Asr },
    { name: 'Maghrib', time: prayerTimes.Maghrib },
    { name: 'Isha', time: prayerTimes.Isha },
  ];
  const nextPrayerObject = fullPrayers.find(p => p.name === nextPrayerName);
  const nextPrayerTimeStr = nextPrayerObject ? nextPrayerObject.time.split(' ')[0] : '';  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundGradient: {
          from: '#0369a1', // Sky-700
          to: '#0f172a',   // Slate-900
          orientation: 'TL_BR',
        },
        borderRadius: 18,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 6,
        paddingBottom: 16,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Header Info (Top section - 1.4 flex) */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: 'match_parent',
          flex: 1.4,
        }}
      >
        {/* Left Side: Meta Info */}
        <FlexWidget style={{ flexDirection: 'column', flex: 1.3, justifyContent: 'center' }}>
          <TextWidget
            text="Muslim Atlas"
            style={{
              fontSize: 17,
              color: '#ffffff',
              fontFamily: 'sans-serif-bold',
              fontWeight: 'bold',
            }}
          />
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <SvgWidget
              svg={locationPinSvg}
              style={{ width: 10, height: 10, marginRight: 3 }}
            />
            <TextWidget
              text={locationName}
              style={{
                fontSize: 11,
                color: '#cbd5e1', // Slate-300
                fontFamily: 'sans-serif-medium',
                fontWeight: 'bold',
              }}
            />
          </FlexWidget>
          <TextWidget
            text={dateLine}
            style={{
              fontSize: 9,
              color: '#bae6fd', // Sky-200
              marginTop: 2,
            }}
          />
        </FlexWidget>
 
        {/* Right Side: Active Tracker & Details */}
        <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end', flex: 0.7, justifyContent: 'center' }}>
          <TextWidget
            text={currentPrayerName || '---'}
            style={{
              fontSize: 22,
              color: '#ffffff', // Bright white active prayer name
              fontFamily: 'sans-serif-bold',
              fontWeight: 'bold',
            }}
          />
          
          {nextPrayerName && nextPrayerTimeStr && (
            <TextWidget
              text={`${nextPrayerName} at ${nextPrayerTimeStr}`}
              style={{
                fontSize: 9,
                color: '#bae6fd',
                marginTop: 1,
              }}
            />
          )}
 
          {/* Sunrise Pill */}
          <FlexWidget
            style={{
              paddingTop: 1.5,
              paddingBottom: 1.5,
              paddingLeft: 5,
              paddingRight: 5,
              borderRadius: 5,
              backgroundColor: '#ffffff26', // rgba(255,255,255,0.15)
              marginTop: 3,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <SvgWidget
              svg={sunIconSvg}
              style={{ width: 9, height: 9, marginRight: 2 }}
            />
            <TextWidget
              text={`Sunrise ${prayerTimes.Sunrise ? prayerTimes.Sunrise.split(' ')[0] : '--:--'}`}
              style={{
                fontSize: 9,
                color: '#ffffff',
                fontFamily: 'sans-serif-medium',
                fontWeight: 'bold',
              }}
            />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
 
      {/* Horizontal Line Divider */}
      <FlexWidget
        style={{
          height: 1,
          width: 'match_parent',
          backgroundColor: '#ffffff33',
          marginTop: 2,
          marginBottom: 2,
        }}
      />
 
      {/* Grid of 5 prayer times (Bottom section - 1.6 flex) */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: 'match_parent',
          flex: 1.6,
        }}
      >
        {prayers.map((p, index) => {
          const isCurrent = p.name === currentPrayerName;
          return (
            <FlexWidget
              key={index}
              style={{
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: 2,
                paddingBottom: 2,
                paddingLeft: 1,
                paddingRight: 1,
                borderRadius: 8,
                flex: 1,
                marginLeft: 1.5,
                marginRight: 1.5,
                ...(isCurrent ? { backgroundColor: '#ffffff33' } : {}),
              }}
            >
              <TextWidget
                text={p.name}
                style={{
                  fontSize: 9,
                  color: isCurrent ? '#ffffff' : '#cbd5e1', // White vs Slate-300
                  textAlign: 'center',
                  fontFamily: 'sans-serif-bold',
                  fontWeight: 'bold',
                }}
              />
              <TextWidget
                text={p.time ? p.time.split(' ')[0] : '--:--'}
                style={{
                  fontSize: 12,
                  color: isCurrent ? '#ffffff' : '#f0f9ff', // White vs Sky-50
                  textAlign: 'center',
                  fontFamily: 'sans-serif-bold',
                  fontWeight: 'bold',
                  marginTop: 1,
                }}
              />
            </FlexWidget>
          );
        })}
      </FlexWidget>
    </FlexWidget>
  );
}
