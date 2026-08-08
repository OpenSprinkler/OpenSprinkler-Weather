import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";

export interface LocalDayGroup<T> {
	date: string;
	records: T[];
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
	const cutoff = localDateKey(before, timezone);
	const groups = groupByLocalDay(records, getTime, timezone).filter(
		group => group.date < cutoff && group.records.length === localDayHours(group.date, timezone)
	);

	return maxDays === undefined ? groups : groups.slice(-maxDays);
}

function localDayHours(date: string, timezone: string): number {
	const [year, month, day] = date.split("-").map(Number);
	const start = new TZDate(year, month - 1, day, 0, 0, 0, timezone);
	const end = new TZDate(year, month - 1, day + 1, 0, 0, 0, timezone);
	return (end.getTime() - start.getTime()) / (60 * 60 * 1000);
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
