import { CodedError, ErrorCode } from "../errors";

/**
 * Makes an HTTP/HTTPS request and parses its JSON response body.
 */
export async function httpJSONRequest(
	url: string,
	headers?: HeadersInit,
	body?: BodyInit
): Promise<any> {
	const response = await fetch(url, { headers, body });
	if (!response.ok) {
		throw new CodedError(
			ErrorCode.WeatherApiError,
			`Weather provider returned HTTP ${response.status}.`
		);
	}

	return response.json();
}
