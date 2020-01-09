let Characteristic, Service, UUIDGen;
let FFMPEG = require('./FFMPEG').FFMPEG;
let camApi = require('./hikvision');
let URL = require('url');

class Camera {
    constructor(nubicam, log, Accessory, hap, enableAudio) {
        Characteristic = hap.Characteristic;
        Service = hap.Service;
        UUIDGen = hap.uuid;

        this.log = log;
        this.log("Setting up camera: %s", nubicam.name);
        this.log.debug(JSON.stringify(nubicam));

        this.name = nubicam.name;
        this.id = nubicam.cameraId;
        this.model = nubicam.model;
        this.motionStatus = false;
        this.isInitialized = false;

        this.cameraAccessory = new Accessory(this.name, UUIDGen.generate(this.id), hap.Accessory.Categories.CAMERA);

        this.cameraAccessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.Manufacturer, "Nubicam")
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.id);

        this.motionSensorService = this.cameraAccessory.addService(Service.MotionSensor)
            .setCharacteristic(Characteristic.MotionDetected, false)
            .on("get", this.getMotionStatus.bind(this));

        let camera = this;

        nubicam.getCameraFeed().then(feed => {
            camera.log.debug(feed);

            if (feed.rtsp) {
                camera.cameraAccessory.configureCameraSource(new FFMPEG(hap, camera.name, feed, log, enableAudio));

                let cameraUrl = URL.parse(feed.rtsp);

                let options = {
                    host: cameraUrl.hostname,
                    port: cameraUrl.port || 80,
                    user: cameraUrl.auth.split(':')[0],
                    pass: cameraUrl.auth.split(':')[1],
                    log: camera.log
                };

                let hikvision = new camApi.hikvision(options);

                hikvision.on('alarm', (code, action, index) => {
                    let startEvent = action === 'Start';

                    switch (code) {
                        case 'VideoMotion':
                            camera.reportMotion(startEvent);
                            break;
                        case 'VideoLoss':
                            camera.reportFault(startEvent);
                            break;
                        case 'VideoBlind':
                            camera.reportTampering(startEvent);
                            break;
                    }
                });
            } else {
                camera.cameraAccessory.configureCameraSource(new FFMPEG(hap, camera.name, nubicam.getCameraFeed.bind(nubicam), log, enableAudio));
            }

            camera.isInitialized = true;
        }).catch(reason => {
            camera.log.debug(reason);
            camera.log.error("Failed initializing camera: %s", JSON.stringify(reason));
            camera.isInitialized = true;
        });
    }

    getAccessory() {
        return this.cameraAccessory;
    }

    getMotionStatus(callback) {
        callback(null, this.motionStatus);
    }

    reportMotion(motionDetected) {
        this.log(motionDetected ? "Motion detected" : "Motion stopped", "by", this.name);
        this.motionStatus = motionDetected;
        this.motionSensorService.getCharacteristic(Characteristic.MotionDetected).updateValue(motionDetected);
    }

    reportFault(isFaulted) {
        this.log(isFaulted ? "Fault detected" : "Fault stopped", "in", this.name);
        this.motionSensorService.getCharacteristic(Characteristic.StatusFault).updateValue(isFaulted);
    }

    reportTampering(isTampered) {
        this.log(isTampered ? "Tampering detected" : "Tampering stopped", "in", this.name);
        this.motionSensorService.getCharacteristic(Characteristic.StatusTampered).updateValue(isTampered);
    }
}

module.exports = {
    Camera
};
