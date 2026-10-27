# ETo Adjustment and Baseline Setup

The ETo adjustment method scales your programmed watering durations using recent
weather. It does not determine the correct starting duration or watering frequency
for each zone.

**Baseline ETo represents the weather conditions for which your programmed watering
durations are appropriate at 100%.** Choose the baseline and the durations together.

In the App, open **Edit Options → Weather Adjustment**, select **ETo** as the
adjustment method, then choose **Adjustment Method Options → Tap to Configure**
to edit **Baseline ETo** in the displayed units (mm/day or in/day).

## How the Adjustment Works

For each available historical day, the service calculates reference
evapotranspiration (ETo), subtracts that day's precipitation, and divides by the
configured baseline:

```text
daily percentage = 100 × (daily ETo − daily rain) / baseline ETo
```

ETo, rain, and baseline ETo must use matching depth units. The API uses inches for
ETo and rain, and inches/day for `baseETo`.

The service returns the most recent day's percentage as `scale`. It also returns
`scales`, containing averages over the most recent one, two, and further available
consecutive days for firmware that supports multiday adjustment. Each result is
clamped to 0–200% and rounded down to a whole percentage after averaging. Weather
restrictions can independently prevent watering.

For a dry day, ETo equal to the baseline gives 100%; higher ETo increases the
duration, and lower ETo reduces it. Rain reduces the percentage. A value above 100%
is therefore expected when recent water demand exceeds the reference conditions.

## What the Suggested Baseline Means

The [`/baselineETo` endpoint](api.md#baseline-eto) uses the MOD16-derived dataset
described in [Baseline ETo Data](../baselineEToData/README.md). It converts the
location's annual value to a daily average by dividing by 365. This is a long-term,
year-round estimate, not a summer average, today's ETo, or a measurement of your
zone's irrigation needs.

The adjustment endpoint uses the configured `baseETo`; it does not automatically
choose a seasonal baseline. Multiday averaging smooths the adjustment but does
not recalibrate the baseline.

## Choosing Durations and a Baseline

For a new schedule, establish an appropriate watering frequency and duration for
each zone, taking account of plant needs, soil, and the water delivered by the
sprinklers or emitters. Use a baseline representative of the conditions for which
those durations are intended. If you keep the suggested annual baseline, your
100% durations should correspond to those annual-average reference conditions.

For an existing schedule that works well in typical dry summer conditions, a
baseline representative of those summer conditions can be a better match. Keep
the unadjusted program durations as the 100% reference; do not use durations that
have already been increased by weather adjustment. A representative baseline
should reflect the reference period, rather than a single unusually hot day.

The baseline is a daily rate even if a program runs every second or third day.
Watering frequency belongs in the program setup; do not multiply `baseETo` by the
number of days between watering events.

After enabling adjustment, monitor the resulting durations and the condition of
the irrigated zones, and calibrate the setup as needed.

## Example: A Summer Schedule with an Annual Baseline

Suppose a zone's 20-minute program is appropriate for dry reference conditions
with ETo of 4.8 mm/day. On a day with that same ETo and no rain:

| Configured baseline | Calculated percentage | Adjusted duration |
| --- | ---: | ---: |
| 4.8 mm/day, matching the program's reference conditions | 100% | 20 minutes |
| 2.8 mm/day, an illustrative annual average | 171% | About 34 minutes |

The annual baseline increases a duration already chosen for summer. Either match
the baseline to those conditions or recalibrate the 100% durations for the annual
reference.

These values illustrate calibration, not recommended settings for a particular
location. For direct API requests, divide mm/day by 25.4: 4.8 mm/day is about
0.189 inches/day, and 2.8 mm/day is about 0.110 inches/day. Use the units displayed
by your client when entering settings through an app.
