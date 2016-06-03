habpack_map
=============

This is a websocket-driven visualisation page for HABpack tracker position data.

A nodejs daemon runs on the server, polling habitat at regular intervals for updates to the configured payload's telemetry.
On receiving new data, the daemon will then push this data down to the client browsers over websockets.
