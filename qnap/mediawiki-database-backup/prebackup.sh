#!/bin/bash

if [ ! -a /backup/stratoHiDrive.flag ]; then
  echo "/backup directory not mounted from Strato HiDrive" >&2
fi
