# homebridge-nubicam
homebridge-plugin for Nubicam (www.nubicam.com.ar)

[![npm version](https://badge.fury.io/js/homebridge-nubicam.svg)](https://badge.fury.io/js/homebridge-roomba-stv)
[![dependencies Status](https://david-dm.org/esteban-mallen/homebridge-nubicam/status.svg)](https://david-dm.org/esteban-mallen/homebridge-nubicam)

### Credits:

- @KhaosT for HAP and the FFMPEG plugin
- @nfarina for homebridge
- @nayrnet for the hikvision module

### Features:

- Camera live feed in Home.app
- Camera snapshots en Home.app favorites
- Motion sensor

## Installation:

### 1. Install homebridge and Roomba plugin.
- 1.1 `npm install -g homebridge`
- 1.2 `npm install -g homebridge-nubicam`

### 2. Update homebridge configuration file.
```
{
  "platform" : "Nubicam",
  "name" : "Nubicam",
  "username" : "username@test.com",
  "password" : "123456"
}
```
