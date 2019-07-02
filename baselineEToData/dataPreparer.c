#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>

#define IMAGE_WIDTH 43200
#define IMAGE_HEIGHT 16800
#define MASK_WIDTH 10800
#define MASK_HEIGHT 5400
#define OUTPUT_FILE_TEMPLATE "./Baseline_ETo_Data-Pass_%d.bin"
#define FILENAME_MAX_LENGTH 40
#define HEADER_SIZE 32

long unsigned CROPPED_TOP_PIXELS = (MASK_WIDTH * MASK_HEIGHT * 10 / 180);
// These will be set by findPixelRange().
uint16_t minPixelValue = 0;
uint16_t maxPixelValue = 0xFFFF;
double bitReductionFactor = 256;


/** Copies the big-endian byte representation of the specified value into the specified buffer. */
void copyBytes(void* input, uint8_t* output, int unsigned length) {
	int unsigned isBigEndian = 1;
	isBigEndian = *((uint8_t*)(&isBigEndian)) == 0;

	for (int unsigned i = 0; i < length; i++) {
		int unsigned index = isBigEndian ? i : length - i - 1;
		output[i] = *((uint8_t*) input + index);
	}
}

/**
 * Write file header to the specified buffer. The header format is documented in the README.
 */
void setHeader(uint8_t *header) {
	for (int unsigned i = 0; i < HEADER_SIZE; i++) {
		header[i] = 0;
	}

	uint32_t width = IMAGE_WIDTH;
	uint32_t height = IMAGE_HEIGHT;
	// originally 0.1, then multiplied by a value to compensate for the bit depth reduction and divided by 25.4 to convert to inches.
	float scalingFactor = 0.1 * bitReductionFactor / 25.4;
	float minimumETo = minPixelValue * 0.1 / 25.4;

	// Version
	header[0] = 1;
	// Width
	copyBytes(&width, &(header[1]), 4);
	// Height
	copyBytes(&height, &(header[5]), 4);
	// Bit depth
	header[9] = 8;
	// Minimum ETo
	copyBytes(&minimumETo, &(header[10]), 4);
	// Scaling factor
	copyBytes(&scalingFactor, &(header[14]), 4);
}

/**
 * Calculates the minimum and maximum pixel values used in the image. These values can be used to optimally reduce the
 * bit depth by mapping the minimum value to 0 and the maximum value to 254 (reserving 255 for fill pixels) and linearly
 * interpolating the rest of the values.
 */
void findPixelRange(uint16_t* minPtr, uint16_t* maxPtr, double* bitReductionFactorPtr) {
	time_t startTime = clock();

	uint16_t minValue = 0xFFFF;
	uint16_t maxValue = 0;

	FILE* inputFile = fopen("./MOD16A3_PET_2000_to_2013_mean.bin", "rb");
	if (inputFile == NULL) {
		printf("An error occurred opening image file while finding min/max value.\n");
		exit(1);
	}
	uint16_t buffer[IMAGE_WIDTH];
	for (int unsigned y = 0; y < IMAGE_HEIGHT; y++) {
		if (y % 1000 == 0) {
			printf("Finding pixel range on row %d...\n", y);
		}

		fread(buffer, 2, IMAGE_WIDTH, inputFile);
		if (ferror(inputFile)) {
			printf("An error occurred reading image row %d while finding min/max values.\n", y);
			exit(1);
		}
		if (feof(inputFile)) {
			printf("Encountered EOF reading image row %d while finding min/max values.\n", y);
			exit(1);
		}

		for (unsigned int x = 0; x < IMAGE_WIDTH; x++) {
			uint16_t pixel = buffer[x];
			// Skip fill pixels.
			if (pixel > 65528) {
				continue;
			}

			minValue = pixel < minValue ? pixel : minValue;
			maxValue = pixel > maxValue ? pixel : maxValue;
		}
	}

	*minPtr = minValue;
	*maxPtr = maxValue;
	*bitReductionFactorPtr = (maxValue - minValue + 1) / (float) 256;

	fclose(inputFile);
	printf("Found pixel range in %.1f seconds. Min value: %d\t Max value: %d\t Bit reduction factor:%f.\n", (clock() - startTime) / (float) CLOCKS_PER_SEC, minValue, maxValue, *bitReductionFactorPtr);
}

/** Reduces the image bit depth from 16 bits to 8 bits. */
void reduceBitDepth() {
	clock_t startTime = clock();
	FILE* originalFile = fopen("./MOD16A3_PET_2000_to_2013_mean.bin", "rb");
	if (originalFile == NULL) {
		printf("An error occurred opening input image file while reducing bit depth.\n");
		exit(1);
	}

	char* reducedFileName = malloc(FILENAME_MAX_LENGTH);
	snprintf(reducedFileName, FILENAME_MAX_LENGTH, OUTPUT_FILE_TEMPLATE, 0);
	FILE* reducedFile = fopen(reducedFileName, "wb");
	if (reducedFile == NULL) {
		printf("An error occurred opening output image file while reducing bit depth.\n");
		exit(1);
	}

	// Write the file header.
	uint8_t header[32];
	setHeader(header);
	fwrite(header, 1, 32, reducedFile);
	if (ferror(reducedFile)) {
		printf("An error occurred writing file header while reducing bit depth.\n");
		exit(1);
	}

	uint16_t inputBuffer[IMAGE_WIDTH];
	uint8_t outputBuffer[IMAGE_WIDTH];
	for (int unsigned y = 0; y < IMAGE_HEIGHT; y++) {
		if (y % 1000 == 0) {
			printf("Reducing bit depth on row %d...\n", y);
		}

		fread(inputBuffer, 2, IMAGE_WIDTH, originalFile);
		if (ferror(originalFile)) {
			printf("An error occurred reading row %d while reducing bit depth.\n", y);
			exit(1);
		}
		if (feof(originalFile)) {
			printf("Encountered EOF reading row %d while reducing bit depth.\n", y);
			exit(1);
		}

		for (unsigned int x = 0; x < IMAGE_WIDTH; x++) {
			uint16_t originalPixel = inputBuffer[x];
			uint8_t reducedPixel = originalPixel > 65528 ? 255 : (uint8_t) ((originalPixel - minPixelValue) / bitReductionFactor);
			outputBuffer[x] = reducedPixel;
		}

		fwrite(outputBuffer, 1, IMAGE_WIDTH, reducedFile);
		if (ferror(reducedFile)) {
			printf("An error occurred writing row %d while reducing bit depth.\n", y);
			exit(1);
		}
	}

	fclose(reducedFile);
	fclose(originalFile);

	printf("Finished reducing bit depth in %.1f seconds.\n", (clock() - startTime) / (double) CLOCKS_PER_SEC);
}

void fillMissingPixels(int unsigned pass) {
	clock_t startTime = clock();

	char* inputFileName = malloc(FILENAME_MAX_LENGTH);
	snprintf(inputFileName, FILENAME_MAX_LENGTH, OUTPUT_FILE_TEMPLATE, pass - 1);
	FILE* inputFile = fopen(inputFileName, "rb");
	if (inputFile == NULL) {
		printf("An error occurred opening input image file on pass %d.\n", pass);
		exit(1);
	}

	char* outputFileName = malloc(FILENAME_MAX_LENGTH);
	snprintf(outputFileName, FILENAME_MAX_LENGTH, OUTPUT_FILE_TEMPLATE, pass);
	FILE* outputFile = fopen(outputFileName, "wb");
	if (outputFile == NULL) {
		printf("An error occurred opening output image file on pass %d.\n", pass);
		exit(1);
	}

	FILE* maskFile = fopen("./Ocean_Mask.bin", "rb");
	if (maskFile == NULL) {
		printf("An error occurred opening mask image on pass %d.\n", pass);
		exit(1);
	}

	uint8_t outputBuffer[IMAGE_WIDTH];

	// Skip the header.
	fseek(inputFile, 32, SEEK_SET);
	if (ferror(inputFile)) {
		printf("An error occurred reading header on pass %d.\n", pass);
		exit(1);
	}
	if (feof(inputFile)) {
		printf("Encountered EOF reading header on pass %d.\n", pass);
		exit(1);
	}

	// Write the file header.
	uint8_t header[32];
	setHeader(header);
	fwrite(header, 1, 32, outputFile);
	if (ferror(outputFile)) {
		printf("An error occurred writing file header on pass %d.\n", pass);
		exit(1);
	}

	uint8_t* rows[5] = {0, 0, 0, 0, 0};
	// Read the first 2 rows.
	for (int unsigned rowIndex = 3; rowIndex < 5; rowIndex++) {
		uint8_t* row = (uint8_t*) malloc(IMAGE_WIDTH);
		fread(row, 1, IMAGE_WIDTH, inputFile);
		if (ferror(inputFile)) {
			printf("An error occurred reading image row %d on pass %d.\n", rowIndex - 3, pass);
			exit(1);
		}
		if (feof(inputFile)) {
			printf("Encountered EOF reading image row %d on pass %d.\n", rowIndex - 3, pass);
			exit(1);
		}

		rows[rowIndex] = row;
	}

	long unsigned fixedPixels = 0;
	long unsigned unfixablePixels = 0;
	long unsigned waterPixels = 0;

	for (int unsigned y = 0; y < IMAGE_HEIGHT; y++) {
		if (y % 1000 == 0) {
			printf("Filling missing pixels on pass %d row %d.\n", pass, y);
		}

		// Read a row from the mask.
		uint8_t maskRow[MASK_WIDTH];
		int unsigned maskOffset = y / (IMAGE_WIDTH / MASK_WIDTH) * MASK_WIDTH + CROPPED_TOP_PIXELS;
		fseek(maskFile, maskOffset, SEEK_SET);
		fread(maskRow, 1, MASK_WIDTH, maskFile);
		if (ferror(maskFile)) {
			printf("An error occurred reading mask at offset %d on pass %d.\n", maskOffset, pass);
			exit(1);
		}
		if (feof(maskFile)) {
			printf("Encountered EOF reading mask at offset %d on pass %d.\n", maskOffset, pass);
			exit(1);
		}

		// Free the oldest row.
		free(rows[0]);
		// Shift the previous rows back.
		for (int unsigned rowIndex = 1; rowIndex < 5; rowIndex++) {
			rows[rowIndex - 1] = rows[rowIndex];
		}

		// Read the next row if one exists.
		if (y < IMAGE_HEIGHT - 2) {
			uint8_t* row = malloc(IMAGE_WIDTH);
			fread(row, 1, IMAGE_WIDTH, inputFile);
			if (ferror(inputFile)) {
				printf("An error occurred reading image row %d on pass %d.\n", y + 2, pass);
				exit(1);
			}
			if (feof(inputFile)) {
				printf("Encountered EOF reading image row %d on pass %d,\n", y + 2, pass);
				exit(1);
			}

			rows[4] = row;
		}

		for (unsigned int x = 0; x < IMAGE_WIDTH; x++) {
			uint8_t pixel = *(rows[2] +x);
			// Skip water pixels.
			if (maskRow[x / (IMAGE_WIDTH / MASK_WIDTH)] > 128) {
				if (pixel == 255) {
					int unsigned totalWeight = 0;
					float neighborTotal = 0;
					for (int i = -2; i <= 2; i++) {
						for (int j = -2; j <= 2; j++) {
							int neighborX = x + i;
							int neighborY = y + j;
							if (neighborX < 0 || neighborX >= IMAGE_WIDTH || neighborY < 0 || neighborY >= IMAGE_HEIGHT) {
								continue;
							}

							uint8_t neighbor = *(rows[2 + j] + neighborX);
							if (neighbor == 255) {
								continue;
							}

							int unsigned weight = 5 - (abs(i) + abs(j));
							neighborTotal += weight * neighbor;
							totalWeight += weight;
						}
					}
					if (totalWeight > 11) {
						pixel = (uint8_t) (neighborTotal / totalWeight);
						fixedPixels++;
					} else {
						unfixablePixels++;
					}
				}
			} else {
				waterPixels++;
			}

			outputBuffer[x] = pixel;
		}

		fwrite(outputBuffer, 1, IMAGE_WIDTH, outputFile);
		if (ferror(outputFile)) {
			printf("An error occurred writing row %d on pass %d.\n", y, pass);
			exit(1);
		}
	}

	fclose(outputFile);
	fclose(inputFile);
	fclose(maskFile);

	printf("Finished pass %d in %f seconds. Fixed pixels: %ld\t Unfixable pixels: %ld\t Water pixels: %ld.\n", pass, (clock() - startTime) / (double) CLOCKS_PER_SEC, fixedPixels, unfixablePixels, waterPixels);
}

int main(int argc, char* argv[]) {
	if (argc != 2) {
		printf("Proper usage: %s <passes>\n", argv[0]);
	}
	int unsigned passes = strtol(argv[1], NULL, 10);
	if (passes <= 0) {
		printf("passes argument must be a positive integer.\n");
		exit(1);
	}

	findPixelRange(&minPixelValue, &maxPixelValue, &bitReductionFactor);
	reduceBitDepth();
	for (int unsigned i = 1; i <= passes; i++) {
		fillMissingPixels(i);
	}

	return 0;
}
