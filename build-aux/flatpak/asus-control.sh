#!/bin/sh
# Launch ASUS Control through zypak so Chromium's sandboxing works inside Flatpak.
exec zypak-wrapper.sh /app/asus-control/electron "$@"
