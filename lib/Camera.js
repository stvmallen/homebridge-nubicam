let Characteristic, Service, UUIDGen;
let FFMPEG = require('./FFMPEG').FFMPEG;
let Jimp = require('jimp');

const LAST_SNAPSHOT = '/tmp/{cameraId}.jpg';

class Camera {
    constructor(nubicam, log, Accessory, hap, motionThreshold) {
        Characteristic = hap.Characteristic;
        Service = hap.Service;
        UUIDGen = hap.uuid;

        this.log = log;
        this.log("Configuring new camera: %s", nubicam.name);
        this.name = nubicam.name;
        this.id = nubicam.cameraId;
        this.model = nubicam.model;
        this.motionThreshold = motionThreshold;

        this.motionStatus = false;
        this.timer;
        this.ffmpeg;

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

        log("Feeding");

        nubicam.getCameraFeed().then(feed => {
            camera.ffmpeg = new FFMPEG(hap, camera.name, feed, log);
            camera.cameraAccessory.configureCameraSource(camera.ffmpeg);

            camera.snapshotFeed = camera.ffmpeg.snapshotSource.replace("rtsp", "http").replace("-i ", "") + "?.jpg";
            Jimp.read(camera.snapshotFeed).then(snapshot => snapshot.write(LAST_SNAPSHOT.replace("{cameraId}", this.id)));
            camera.log("DONE!");
        });

        this.monitorMotion();
    }

    getMotionStatus(callback) {
        this.log.debug("Motion status requested");

        let currentStatus = false;
        let error;
        let camera = this;

        if (camera.snapshotFeed) {
            Jimp.read(camera.snapshotFeed).then(newSnapshot => {
                Jimp.read(LAST_SNAPSHOT.replace("{cameraId}", this.id)).then(lastSnapshot => {
                    let diff = Jimp.diff(lastSnapshot, newSnapshot);

                    camera.log.debug("Diff: %s", diff.percent);

                    if (diff.percent > this.motionThreshold) {
                        currentStatus = true;
                    }

                    callback(null, currentStatus);

                    newSnapshot.write(LAST_SNAPSHOT.replace("{cameraId}", this.id))
                }).catch(reason => {
                    camera.log.error("Error checking motion for %s: %s", camera.name, reason);
                    error = reason;
                });
            }).catch(reason => {
                camera.log.error("Error checking motion for %s: %s", camera.name, reason);
                error = reason;
            });
        }
    }

    getAccessory() {
        return this.cameraAccessory;
    }

    monitorMotion() {
        clearTimeout(this.timer);

        let camera = this;

        this.timer = setTimeout(() => {
            camera.getMotionStatus((error, motionDetected) => {
                if (!error) {
                    if (motionDetected !== camera.motionStatus) {
                        camera.log("Motion detected on %s", camera.name);
                        camera.motionStatus = motionDetected;
                        camera.motionSensorService.getCharacteristic(Characteristic.MotionDetected).updateValue(motionDetected);
                    }
                }
            });
            camera.monitorMotion();
        }, 1500);
    }
}

module.exports = {
    Camera
};
