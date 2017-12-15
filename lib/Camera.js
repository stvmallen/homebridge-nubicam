let FFMPEG = require('./FFMPEG').FFMPEG;
let Charact;

class Camera {
    constructor(nubicam, log, Accessory, hap, UUIDGen, Service, Characteristic) {
        this.log = log;

        this.log("Configuring new Camera: %s", nubicam.name);

        Charact = Characteristic;
        let cameraAccessory = new Accessory(nubicam.name, UUIDGen.generate(nubicam.name), hap.Accessory.Categories.CAMERA);

        cameraAccessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Name, nubicam.name)
            .setCharacteristic(Characteristic.Manufacturer, "Nubicam")
            .setCharacteristic(Characteristic.Model, nubicam.model)
            .setCharacteristic(Characteristic.SerialNumber, nubicam.cameraId);

        this.motionSensorService = cameraAccessory.addService(Service.MotionSensor)
            .setCharacteristic(Characteristic.MotionDetected, false)
            .on("get", this.getMotionStatus.bind(this));

        nubicam.getCameraFeed()
            .then((feed) => {
                cameraAccessory.configureCameraSource(new FFMPEG(hap, feed, log));
            }).catch(reason => log.error(reason));

        this.accessory = cameraAccessory;

        this.timer;
        this.motionStatus;

        this.monitorMotion();

        this.counter = 0;
    }

    getMotionStatus(callback) {
        this.log("Motion status requested");
        this.log("Motion = %s", this.counter);

        //getSnapshot();

        let currentStatus = false;

        if (this.counter == 5) {
            currentStatus = true;
            this.counter = 0;
        }

        this.counter++;

        callback(null, currentStatus);
    }

    getAccessory() {
        return this.accessory;
    }

    monitorMotion() {
        clearTimeout(this.timer);

        let that = this;

        this.timer = setTimeout(() => {
            that.getMotionStatus((error, motionDetected) => {
                if (!error) {
                    if (motionDetected !== that.motionStatus) {
                        that.log("Motion detected");
                        that.motionStatus = motionDetected;
                        that.motionSensorService.getCharacteristic(Charact.MotionDetected).updateValue(motionDetected);
                    }
                }
            });
            that.monitorMotion();
        }, 1000);
    }
}

module.exports = {
    Camera
};
