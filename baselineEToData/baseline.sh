#!/bin/sh
# Move the last pass to the output directory.
mv $(ls -1t Baseline_ETo_Data-Pass_*.bin | head -n1) Baseline_ETo_Data.bin
