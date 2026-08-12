import path from "path";

export interface ServerPortEnvironment {
	PORT?: string;
	HTTP_PORT?: string;
}

export interface PersistenceEnvironment {
	LOCAL_PERSISTENCE?: string;
	PERSISTENCE_LOCATION?: string;
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

export function localPersistenceEnabled(environment: PersistenceEnvironment = process.env): boolean {
	const value = environment.LOCAL_PERSISTENCE;
	if (value === undefined) return false;

	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			throw new Error(`Invalid LOCAL_PERSISTENCE value: ${value}`);
	}
}

export function resolvePersistenceFile(fileName: string, environment: PersistenceEnvironment = process.env): string {
	const directory = environment.PERSISTENCE_LOCATION?.trim();
	return path.resolve(directory || ".", fileName);
}
