import { isAfter, differenceInMilliseconds } from 'date-fns';
import { Mutex } from 'async-mutex';

export type CachedResult<T> = {
	value: T,
	ttl: number,
}

export class Cached<T> {
	private mutex: Mutex;
	private value: Promise<T> | null = null;
	private expiresAt: Date | null = null;

	constructor() {
		this.mutex = new Mutex();
	}

	async get(getter: () => Promise<T>, expiresAt: Date): Promise<CachedResult<T>> {
		if (this.expiresAt && isAfter(new Date(), this.expiresAt)) {
			await this.invalidate();
		}

		const release = await this.mutex.acquire();
		if (!this.value) {
			this.value = getter().then((value) => {
				console.log("new value");
				this.expiresAt = expiresAt;
				return value;
			});
		}

		release();
		return {
			value: await this.value,
			ttl: differenceInMilliseconds(this.expiresAt, new Date()),
		};
	}

	async invalidate(): Promise<void> {
		this.value = null;
		this.expiresAt = null;
	}
}
