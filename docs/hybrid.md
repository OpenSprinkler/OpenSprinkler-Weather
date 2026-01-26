# 📚 Hybrid Weather Provider - Data Flow Documentation

## 🎯 Overview: Three Types of Weather Data

The Hybrid Provider works with **three different data types** that are often confused:

### 1️⃣ **Current Weather** (Right Now)
**Method:** `getWeatherDataInternal()`  
**Source:** Local Weather Station  
**Time Period:** Last 24 hours (for averages)  
**Used For:**
- Mobile app display ("Current Weather")
- Rain delay decisions
- "Is it raining RIGHT NOW?"
- "What's the temperature RIGHT NOW?"

**Example Data:**
```typescript
{
  temp: 18.5,           // Current temperature
  humidity: 75,         // Current humidity
  raining: true,        // Is it raining NOW?
  precip: 2.5,          // mm rain in last 24h
  wind: 12,             // Current wind
  weatherProvider: "local"
}
```

**Important:** This data is **REAL-TIME MEASUREMENTS** from your station!

---

### 2️⃣ **Historical Data** (Past)
**Method:** `getWateringDataInternal()` from LocalProvider  
**Source:** Local Weather Station  
**Time Period:** Last 7 days + today up to now  
**Used For:**
- Zimmerman Watering Scale calculation
- Multi-Day algorithm
- Trend analysis

**Example Data:**
```typescript
[
  {
    periodStartTime: 1736899200,  // Jan 15, 00:00
    temp: 16.2,                    // Daily average
    humidity: 68,
    precip: 0,                     // No rain that day
    minTemp: 12.5,
    maxTemp: 19.8,
    solarRadiation: 3.2,           // kWh/m²/day
    windSpeed: 8.5,
    weatherProvider: "local"
  },
  {
    periodStartTime: 1736985600,  // Jan 16, 00:00
    temp: 17.5,
    humidity: 72,
    precip: 5.2,                   // 5.2mm rain!
    minTemp: 14.1,
    maxTemp: 21.3,
    solarRadiation: 2.1,           // Less sun (cloudy)
    windSpeed: 10.2,
    weatherProvider: "local"
  },
  // ... more days ...
  {
    periodStartTime: 1737504000,  // Jan 18, 00:00 (TODAY)
    temp: 18.2,                    // Average from 00:00-now (6PM)
    humidity: 75,
    precip: 2.5,                   // Rain today so far
    minTemp: 16.5,
    maxTemp: 19.9,
    solarRadiation: 2.8,           // So far today
    windSpeed: 9.1,
    weatherProvider: "local"
  }
]
```

**Important:** Each day is **MEASURED** by your station - no forecasts!

---

### 3️⃣ **Forecast Data** (Future)
**Method:** `getWateringDataInternal()` from ForecastProvider  
**Source:** Apple Weather / OpenMeteo / etc.  
**Time Period:** Tomorrow through +7 days  
**Used For:**
- Zimmerman Watering Scale calculation
- Forward-looking irrigation planning
- "What will the weather be like the next few days?"

**Example Data:**
```typescript
[
  {
    periodStartTime: 1737590400,  // Jan 19, 00:00 (TOMORROW)
    temp: 20.5,                    // Predicted average temperature
    humidity: 65,
    precip: 0,                     // No rain expected
    minTemp: 17.2,
    maxTemp: 23.8,
    solarRadiation: 4.5,           // Sunny expected
    windSpeed: 7.2,
    weatherProvider: "OpenMeteo"
  },
  {
    periodStartTime: 1737676800,  // Jan 20, 00:00
    temp: 22.1,
    humidity: 60,
    precip: 0,
    minTemp: 18.5,
    maxTemp: 25.7,
    solarRadiation: 5.1,
    windSpeed: 6.8,
    weatherProvider: "OpenMeteo"
  },
  // ... more days through +7 ...
]
```

**Important:** This data is **PREDICTIONS** - not measured!

---

## 🔄 How Hybrid Combines These

### Scenario: January 18, 6:00 PM

```typescript
// 1. Open OpenSprinkler App → Shows "Current Weather"
const current = await hybrid.getWeatherDataInternal();
// → Shows: 18.2°C, 75% humidity, raining (2.5mm today)
// → Source: Local Station (REAL-TIME)

// 2. Plan irrigation → Calculate Zimmerman
const watering = await hybrid.getWateringDataWithForecastProvider(coords, pws, "OpenMeteo");
// → Returns:
[
  // MEASURED (Past):
  { day: "Jan 11", temp: 15.2, precip: 0,   source: "local" },
  { day: "Jan 12", temp: 16.8, precip: 1.2, source: "local" },
  { day: "Jan 13", temp: 17.1, precip: 0,   source: "local" },
  { day: "Jan 14", temp: 15.9, precip: 0,   source: "local" },
  { day: "Jan 15", temp: 16.2, precip: 0,   source: "local" },
  { day: "Jan 16", temp: 17.5, precip: 5.2, source: "local" },  // Rain!
  { day: "Jan 17", temp: 18.0, precip: 0,   source: "local" },
  { day: "Jan 18", temp: 18.2, precip: 2.5, source: "local" },  // Today through 6PM
  
  // FORECAST (Future):
  { day: "Jan 19", temp: 20.5, precip: 0,   source: "OpenMeteo" },  // Tomorrow
  { day: "Jan 20", temp: 22.1, precip: 0,   source: "OpenMeteo" },
  { day: "Jan 21", temp: 21.8, precip: 0,   source: "OpenMeteo" },
  { day: "Jan 22", temp: 20.2, precip: 3.0, source: "OpenMeteo" },  // Rain expected
  { day: "Jan 23", temp: 18.5, precip: 1.5, source: "OpenMeteo" },
  { day: "Jan 24", temp: 19.1, precip: 0,   source: "OpenMeteo" },
  { day: "Jan 25", temp: 20.8, precip: 0,   source: "OpenMeteo" }
]

// 3. Zimmerman algorithm analyzes these 15 days:
// - Jan 16: 5.2mm rain (measured!) → Soil was wet
// - Jan 18: 2.5mm rain (measured!) → Soil is wet now
// - Jan 22: 3.0mm rain expected → Soil will be wet
// → Decision: Reduce watering to 40%
```

---

## 🎯 Why This Is Brilliant

### ✅ Advantages of the Hybrid Approach:

**1. Precise Past**
- You know EXACTLY how much it rained
- You know EXACTLY how warm it was
- No estimates, no errors

**2. Reliable Future**
- Professional weather models
- Multiple data sources combined
- Better than "just continue the trend"

**3. Optimal Decisions**
```
Bad Approach (forecast only):
"It rained 4mm on Jan 16 (forecast said 5mm)"
→ Inaccurate! Maybe it was 8mm or 0mm

Bad Approach (local only):
"Tomorrow will probably be... uh... like today?"
→ Inaccurate! Weather changes

Hybrid Approach:
"It rained EXACTLY 5.2mm on Jan 16 (measured!)"
"It will rain about 3mm on Jan 22 (forecast)"
→ Best available data for optimal irrigation!
```

---

## 🔍 Confusing Terms Clarified

| Term | What Some Think | What It REALLY Means |
|------|-----------------|----------------------|
| **"Local"** | Only past | Past + CURRENT + Today |
| **"Historical"** | Only old data | Past + Today up to now |
| **"Current"** | Just 1 data point | Average of last 24h |
| **"Forecast"** | Everything after now | ONLY from tomorrow (today = local!) |

---

## 📋 Cheat Sheet for Developers

```typescript
// ❓ When is what called?

// Mobile app shows current weather:
→ getWeatherDataInternal()
  → LocalProvider.getWeatherDataInternal()
  → Returns 1 WeatherData object (NOW)

// OpenSprinkler checks for rain delay:
→ getWeatherDataInternal()
  → checks: data.raining === true?
  → Source: Last 24h from local station

// Zimmerman calculates watering scale:
→ getWateringDataWithForecastProvider("OpenMeteo")
  → LocalProvider.getWateringDataInternal()
    → Returns array of 8 WateringData (7 days + today)
  → OpenMeteoProvider.getWateringDataInternal()
    → Returns array of 7 WateringData (tomorrow through +7)
  → Combined into 15 WateringData
  → Zimmerman analyzes all 15 days
```

---

## 🐛 Common Misunderstandings

### ❌ WRONG:
> "Hybrid uses Local only for past, Forecast for today"

### ✅ CORRECT:
> "Hybrid uses Local for past AND today, Forecast only from tomorrow"

---

### ❌ WRONG:
> "Current Weather comes from Forecast Provider"

### ✅ CORRECT:
> "Current Weather always comes from local station (except fallback)"

---

### ❌ WRONG:
> "Historical Data ends yesterday at midnight"

### ✅ CORRECT:
> "Historical Data includes today from 00:00 to now"

---

## 💡 For Pull Request / Documentation

When changing comments in the code, make sure you:

1. ✅ **Clearly separate three data types:** Current, Historical, Forecast
2. ✅ **Define time periods precisely:** "NOW", "last 7 days + today", "tomorrow through +7"
3. ✅ **Specify sources:** "Local Station", "Forecast Provider"
4. ✅ **Explain use cases:** "Rain Delay", "Zimmerman", "App Display"
5. ✅ **Give examples:** With real timestamps and values

**Avoid vague terms like:**
- ❌ "Historical" (without saying today is included)
- ❌ "Past" (without time range)
- ❌ "Local data" (without saying current + historical)

**Use precise terms:**
- ✅ "Past 7 days + today (00:00 to now)"
- ✅ "Current conditions (last 24 hours)"
- ✅ "Tomorrow through +7 days"

---

## 🎉 Summary

**Hybrid Weather Provider = Three data sources optimally combined:**

1. **Now (Current):** Your station measures LIVE → Rain delay works
2. **Yesterday + Today:** Your station MEASURED → Precise history
3. **Tomorrow + Future:** Professionals PREDICTED → Good planning

= **Best irrigation decisions!** 💧🌱

---

## 📖 Additional Notes

### Why Today is Split (00:00 to now vs now to 23:59)?

**Morning Scenario (10:00 AM):**
- Local station has data from 00:00 to 10:00 (10 hours of measurements)
- This is REAL data that already happened
- Forecast provider might have predicted 0mm rain, but you actually got 5mm!
- Using local data ensures Zimmerman knows the ACTUAL conditions

**Evening Scenario (10:00 PM):**
- Local station has data from 00:00 to 22:00 (22 hours of measurements)
- Only 2 hours left in the day
- Local data is nearly complete and highly accurate
- Much better than using a forecast made yesterday

### Why Filter Forecast to Start Tomorrow?

```typescript
// In hybrid.ts line 116:
const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
forecastData = forecastResult.filter(data => 
    data.periodStartTime >= tomorrowEpoch  // Only from tomorrow
);
```

**Reason:** Forecast providers often return data for "today" in their response, but:
1. Their "today" data was predicted yesterday (outdated)
2. Your local station has ACTUAL measurements for today
3. Mixing predicted and measured data for the same day causes confusion
4. Filtering ensures clean separation: Local = Past+Today, Forecast = Future

### Error Handling

The hybrid provider gracefully degrades:

```typescript
// Best case: Local works + Forecast works
→ Returns 8 local days + 7 forecast days = 15 days total

// Local fails, Forecast works:
→ Returns 0 local days + 7 forecast days = 7 days total
→ (Zimmerman might not have enough data)

// Local works, Forecast fails:
→ Returns 8 local days + 0 forecast days = 8 days total
→ (Still enough for Zimmerman! Can work with local only)

// Both fail:
→ Throws InsufficientWeatherData error
```

This means your irrigation can still work even if:
- Your internet goes down (local station keeps providing data)
- The forecast API is unavailable (local provides 8 days minimum)
- Your station goes offline temporarily (forecast provides predictions)

---

## 🔧 Implementation Details

### Cache Behavior

```typescript
public shouldCacheWateringScale(): boolean {
    return true;
}
```

**Why cache?**
- Historical data never changes (the past is fixed)
- Reduces load on local station
- Reduces API calls to forecast provider
- Cache expires at end of day (midnight)

### Data Freshness

| Data Type | Update Frequency | Cache Duration |
|-----------|------------------|----------------|
| Current Weather | Every 5-15 minutes (from PWS) | 24 hours |
| Historical Data | Once per day (at midnight) | Until midnight |
| Forecast Data | Every 1-6 hours (from provider) | Per provider settings |

### Minimum Data Requirements

For Zimmerman to work, you need:
- At least 23 hours of continuous data
- All required fields: temp, humidity, precip, solar, wind
- At least 1 day of data (preferably 7-14 days)

The hybrid provider ensures this by:
1. Checking data span in local.ts (line 80)
2. Requiring all metrics for each day (line 118, 163)
3. Graceful degradation if forecast unavailable

---

## 🎯 Best Practices

### For OpenSprinkler Users:

1. **Use OpenMeteo as forecast provider**
   - Free, unlimited, reliable
   - All fields complete (no errCode: 11)
   - Better for irrigation than Apple

2. **Ensure LOCAL_PERSISTENCE=true**
   - Required for data to persist across restarts
   - Saves observations.json to disk every 30 minutes

3. **Let system collect data for 24+ hours**
   - First day: Limited functionality
   - After 24 hours: Full Zimmerman calculations
   - After 7 days: Optimal multi-day analysis

4. **Monitor your station's data quality**
   - Check observations.json periodically
   - Ensure all sensors working (temp, humidity, rain, solar, wind)
   - Missing sensors will cause days to be skipped

### For Developers:

1. **Always check error codes**
   - errCode: 10 = InsufficientWeatherData (not enough data)
   - errCode: 11 = MissingWeatherField (incomplete response)
   - Handle both gracefully

2. **Log data sources clearly**
   - Use `[HybridWeather]`, `[LocalWeather]` prefixes
   - Include counts: "Retrieved 8 days from local"
   - Help users debug issues

3. **Test edge cases**
   - Station offline for 12 hours
   - Forecast API down
   - Partial day data (early morning)
   - All sensors vs missing sensors

4. **Document time zones**
   - Use `localTime(coordinates)` consistently
   - Explain that "today" is in user's local time
   - Avoid UTC confusion

---

## 📚 Further Reading

- **Zimmerman Algorithm:** See `ZimmermanAdjustmentMethod.ts`
- **Local Weather Provider:** See `local.ts` for data collection
- **Weather Underground Protocol:** See `docs/pws-protocol.md`
- **WeeWX Integration:** See `docs/weewx.md`
