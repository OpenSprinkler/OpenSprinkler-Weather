#!/bin/sh
echo "Compiling dataPreparer.c..."
gcc -std=c99 -o dataPreparer dataPreparer.c

echo "Downloading ocean mask image..."
wget http://static1.squarespace.com/static/58586fa5ebbd1a60e7d76d3e/t/59394abb37c58179160775fa/1496926933082/Ocean_Mask.png

echo "Converting ocean mask image to binary format..."
magick Ocean_Mask.png -depth 8 gray:Ocean_Mask.bin

echo "Downloading MOD16 GeoTIFF..."
wget http://files.ntsg.umt.edu/data/NTSG_Products/MOD16/MOD16A3.105_MERRAGMAO/Geotiff/MOD16A3_PET_2000_to_2013_mean.tif

echo "Converting MOD16 GeoTIFF to binary format..."
magick MOD16A3_PET_2000_to_2013_mean.tif -depth 16 gray:MOD16A3_PET_2000_to_2013_mean.bin

echo "Preparing data..."
./dataPreparer $1
