#!/bin/bash

if [ ! -f /backup/stratoHiDrive.flag ]; then
  echo "/backup directory not mounted from Strato HiDrive" >&2
fi
