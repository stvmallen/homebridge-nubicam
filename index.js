let Accessory, hap, UUIDGen, Service, Characteristic;
let ubiguardAPI = require('./lib/ubiguard');
let CameraAccessory = require('./lib/Camera').Camera;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;
    UUIDGen = homebridge.hap.uuid;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerPlatform("homebridge-nubicam", "Nubicam", nubicam, true);
};

const nubicam = function (log, config, api) {
    this.log = log;
    this.api = api;

    this.nubicamUsername = config.username;
    this.nubicamPassword = config.password;

    if (!api || api.version < 2.1) {
        throw new Error('Unexpected API version.')
    }

    api.on('didFinishLaunching', this.didFinishLaunching.bind(this))
};

nubicam.prototype = {
    configureAccessory(accessory) {
        this.log("configureAccessory() invoked! %s");
    },

    didFinishLaunching() {
        this.log("Finish launch");

        let platform = this;

        let user = new ubiguardAPI.User(this.nubicamUsername, this.nubicamPassword);

        user.login()
            .then(() => {
                platform.log.debug("Nubicam User ID = %s", user.userId);

                let cameraAccessories = [];

                user.getCameras()
                    .then((cameras) => {
                        cameras.forEach(camera => {
                            cameraAccessories.push(new CameraAccessory(new ubiguardAPI.Camera(user, camera), platform.log, Accessory, hap, UUIDGen, Service, Characteristic).getAccessory());
                        });

                        platform.api.publishCameraAccessories("Nubicam", cameraAccessories)
                    }).catch(reason => platform.log.error(reason));
            }).catch(reason => platform.log.error(reason));
    }
};
