#!/bin/bash -e

while getopts ":hp:r" opt; do
  case ${opt} in
    h )
      echo "Usage:"
      echo "    -h                    Display this help message."
      echo "    -p 20                 Use 20 passes when generating baseline ETo data (20 is default)."
      echo "    -r                    Force regeneration of baseline ETo data even if file exists"
      exit 0
      ;;
    p )
      PASSES=$OPTARG
      echo "Using $PASSES passes for ETo data.  Pass -r to force regeneration"
      ;;
    r )
      echo "Forcing a rebuild of ETo data"
      REBUILD=true
      ;;
    \? )
      echo "Invalid Option: -$OPTARG" 1>&2
      exit 1
      ;;
  esac
done
shift $((OPTIND -1))

if [ ! -f baselineEToData/Baseline_ETo_Data.bin ] || [ -n "$REBUILD" ] ; then
  echo "Building ETo Data"
  cd baselineEToData
  docker build -t baseline-eto-data-preparer . && docker run --rm -v $(pwd):/output baseline-eto-data-preparer $PASSES
  cd -
else
  echo "Not generating baselineEToData, file already exists"
fi

if [ ! -f .env ] ; then
  echo "Please create a .env configuration file in this directory before running"
  echo "See https://github.com/OpenSprinkler/OpenSprinkler-Weather/blob/master/docs/local-installation.md for examples"
  echo "Ensure that it contains the following: (default PORT is fine)"
  echo " HOST=0.0.0.0"
  exit 1
fi

if ! grep 'HOST=0.0.0.0' .env > /dev/null ; then
  echo "Please ensure that your .env file contains 'HOST=0.0.0.0' in addition to other configuration options"
  exit 1
fi

docker build -t opensprinkler-weather .