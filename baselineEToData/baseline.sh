#!/bin/sh
# Move the last pass to the output directory.
mv $(ls Baseline_ETo_Data-Pass_*.bin | tail -n1) Baseline_ETo_Data.bin
