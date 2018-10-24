let Accessory, hap;
let ubiguardAPI = require('./lib/ubiguard');
let CameraAccessory = require('./lib/Camera').Camera;
let WaitUntil = require('wait-until');

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;

    homebridge.registerPlatform("homebridge-nubicam", "Nubicam", nubicam, true);
};

const nubicam = function (log, config, api) {
    this.log = log;
    this.api = api;

    this.nubicamUsername = config.username;
    this.nubicamPassword = config.password;
    this.enableAudio = config.enableAudio;
    this.cameraAccessories = [];

    if (!api || api.version < 2.1) {
        throw new Error('Unexpected API version.')
    }

    api.on('didFinishLaunching', this.didFinishLaunching.bind(this))
};

nubicam.prototype = {
    configureAccessory(accessory) {
        this.log("configureAccessory() invoked! %s", accessory);
    },

    didFinishLaunching() {
        let platform = this;

        let user = new ubiguardAPI.User(this.nubicamUsername, this.nubicamPassword);

        user.login()
            .then(() => {
                platform.log.debug("Nubicam User ID = %s", user.userId);

                user.getCameras()
                    .then((cameras) => {
                        platform.log("Found %s cameras", cameras.length);

                        cameras.forEach(camera => {
                            platform.cameraAccessories.push(new CameraAccessory(new ubiguardAPI.Camera(user, camera), platform.log, Accessory, hap, platform.enableAudio));
                        });

                        WaitUntil()
                            .interval(500)
                            .times(60)
                            .condition(function () {
                                return platform.cameraAccessories.every(camera => camera.isInitialized);
                            })
                            .done((allCamerasInitialized) => {
                                if (!allCamerasInitialized) {
                                    platform.log.warn("Some cameras are not fully initialized");
                                }

                                platform.api.publishCameraAccessories("Nubicam", platform.cameraAccessories.map(camera => camera.getAccessory()));
                            });
                    }).catch(reason => platform.log.error(reason));
            }).catch(reason => platform.log.error(reason));
    }
};
