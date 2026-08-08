export interface ServerPortEnvironment {
	PORT?: string;
	HTTP_PORT?: string;
}

const DEFAULT_SERVER_PORT = 3000;

export function resolveServerPort(environment: ServerPortEnvironment = process.env): number {
	const value = environment.PORT ?? environment.HTTP_PORT;
	if (value === undefined) return DEFAULT_SERVER_PORT;

	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid server port: ${value}`);
	}
	return port;
}
