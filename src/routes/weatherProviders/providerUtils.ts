import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";

export interface LocalDayGroup<T> {
	date: string;
	records: T[];
}

export interface LocalDayWindow {
	date: string;
	start: Date;
	end: Date;
}

export function finiteValues(values: unknown[]): number[] {
	return values.filter(Number.isFinite) as number[];
}

export function averageFinite(values: unknown[]): number | undefined {
	const samples = finiteValues(values);
	return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : undefined;
}

export function minFinite(values: unknown[]): number | undefined {
	const samples = finiteValues(values);
	return samples.length ? Math.min(...samples) : undefined;
}

export function maxFinite(values: unknown[]): number | undefined {
	const samples = finiteValues(values);
	return samples.length ? Math.max(...samples) : undefined;
}

export function sumFinite(values: unknown[]): number | undefined {
	const samples = finiteValues(values);
	return samples.length ? samples.reduce((sum, value) => sum + value, 0) : undefined;
}

export function localDateKey(value: Date | string | number, timezone: string): string {
	const date = value instanceof Date ? value : new Date(value);
	return format(new TZDate(date.getTime(), timezone), "yyyy-MM-dd");
}

export function groupByLocalDay<T>(
	records: readonly T[],
	getTime: (record: T) => Date | string | number,
	timezone: string
): LocalDayGroup<T>[] {
	const sorted = [...records].sort((a, b) => +new Date(getTime(a)) - +new Date(getTime(b)));
	const groups = new Map<string, T[]>();

	for (const record of sorted) {
		const date = localDateKey(getTime(record), timezone);
		const group = groups.get(date);
		if (group) {
			group.push(record);
		} else {
			groups.set(date, [record]);
		}
	}

	return Array.from(groups, ([date, groupedRecords]) => ({ date, records: groupedRecords }));
}

export function completeHistoricalHourlyDays<T>(
	records: readonly T[],
	getTime: (record: T) => Date | string | number,
	timezone: string,
	before: Date,
	maxDays?: number
): LocalDayGroup<T>[] {
	const groups = new Map(groupByLocalDay(records, getTime, timezone).map(group => [group.date, group]));
	const result: LocalDayGroup<T>[] = [];
	const limit = maxDays === undefined ? groups.size : Math.max(0, maxDays);
	let date = shiftLocalDate(localDateKey(before, timezone), -1, timezone);

	for (let count = 0; count < limit; count++) {
		const group = groups.get(date);
		if (!group || !hasCompleteHourlyTimeline(group, getTime, timezone)) break;
		result.push(group);
		date = shiftLocalDate(date, -1, timezone);
	}

	// Provider implementations historically build oldest-first and reverse once complete.
	return result.reverse();
}

export function localDayWindow(date: string, timezone: string): LocalDayWindow {
	const [year, month, day] = date.split("-").map(Number);
	const start = new TZDate(year, month - 1, day, 0, 0, 0, timezone);
	const end = new TZDate(year, month - 1, day + 1, 0, 0, 0, timezone);
	return { date, start, end };
}

export function shiftLocalDate(date: string, days: number, timezone: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return format(new TZDate(year, month - 1, day + days, 0, 0, 0, timezone), "yyyy-MM-dd");
}

function hasCompleteHourlyTimeline<T>(
	group: LocalDayGroup<T>,
	getTime: (record: T) => Date | string | number,
	timezone: string
): boolean {
	const window = localDayWindow(group.date, timezone);
	const times = Array.from(new Set(group.records.map(record => +new Date(getTime(record)))))
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	const hourMilliseconds = 60 * 60 * 1000;
	const expectedHours = (window.end.getTime() - window.start.getTime()) / hourMilliseconds;
	const slots = new Set(times
		.filter(time => time >= window.start.getTime() && time < window.end.getTime())
		.map(time => Math.floor((time - window.start.getTime()) / hourMilliseconds)));

	return times.length === expectedHours && slots.size === expectedHours &&
		Array.from({ length: expectedHours }, (_, hour) => hour).every(hour => slots.has(hour));
}

export function timeWeightedAverage<T>(
	records: readonly T[],
	getTime: (record: T) => number,
	getValue: (record: T) => unknown
): number | undefined {
	const sorted = [...records].sort((a, b) => getTime(a) - getTime(b));
	let weightedTotal = 0;
	let totalSeconds = 0;

	for (let index = 1; index < sorted.length; index++) {
		const previousValue = getValue(sorted[index - 1]);
		const currentValue = getValue(sorted[index]);
		const seconds = getTime(sorted[index]) - getTime(sorted[index - 1]);
		if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue) || seconds <= 0) {
			continue;
		}
		weightedTotal += ((previousValue as number) + (currentValue as number)) / 2 * seconds;
		totalSeconds += seconds;
	}

	return totalSeconds ? weightedTotal / totalSeconds : undefined;
}

export function maximumTimeGap<T>(records: readonly T[], getTime: (record: T) => number): number {
	const times = records.map(getTime).filter(Number.isFinite).sort((a, b) => a - b);
	let maximum = 0;
	for (let index = 1; index < times.length; index++) {
		maximum = Math.max(maximum, times[index] - times[index - 1]);
	}
	return maximum;
}

export function hasTimeSeriesCoverage<T>(
	records: readonly T[],
	getTime: (record: T) => number,
	getValue: (record: T) => unknown,
	maximumGap: number
): boolean {
	const allTimes = records.map(getTime).filter(Number.isFinite).sort((a, b) => a - b);
	const valid = records.filter(record => Number.isFinite(getValue(record)));
	const validTimes = valid.map(getTime).filter(Number.isFinite).sort((a, b) => a - b);
	if (!allTimes.length || validTimes.length < 2) return false;
	return validTimes[0] - allTimes[0] <= maximumGap &&
		allTimes[allTimes.length - 1] - validTimes[validTimes.length - 1] <= maximumGap &&
		maximumTimeGap(valid, getTime) <= maximumGap;
}

export function hasWindowCoverage<T>(
	records: readonly T[],
	getTime: (record: T) => number,
	getValue: (record: T) => unknown,
	windowStart: number,
	windowEnd: number,
	maximumGap: number
): boolean {
	const valid = records
		.filter(record => Number.isFinite(getTime(record)) && Number.isFinite(getValue(record)))
		.sort((a, b) => getTime(a) - getTime(b));
	if (!valid.length || getTime(valid[0]) - windowStart > maximumGap ||
		windowEnd - getTime(valid[valid.length - 1]) > maximumGap) {
		return false;
	}
	return maximumTimeGap(valid, getTime) <= maximumGap;
}

export function timeWeightedAverageInWindow<T>(
	records: readonly T[],
	getTime: (record: T) => number,
	getValue: (record: T) => unknown,
	windowStart: number,
	windowEnd: number
): number | undefined {
	const valid = records
		.filter(record => Number.isFinite(getTime(record)) && Number.isFinite(getValue(record)))
		.sort((a, b) => getTime(a) - getTime(b));
	if (!valid.length || windowEnd <= windowStart) return undefined;

	let weightedTotal = (getValue(valid[0]) as number) * Math.max(0, getTime(valid[0]) - windowStart);
	for (let index = 1; index < valid.length; index++) {
		const seconds = getTime(valid[index]) - getTime(valid[index - 1]);
		weightedTotal += ((getValue(valid[index - 1]) as number) + (getValue(valid[index]) as number)) / 2 * seconds;
	}
	weightedTotal += (getValue(valid[valid.length - 1]) as number) *
		Math.max(0, windowEnd - getTime(valid[valid.length - 1]));
	return weightedTotal / (windowEnd - windowStart);
}
