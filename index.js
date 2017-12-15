let Accessory, hap, UUIDGen;
let ubiguardAPI = require('./lib/ubiguard');
let FFMPEG = require('./lib/FFMPEG').FFMPEG;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;
    UUIDGen = homebridge.hap.uuid;

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
                            let nubicamCamera = new ubiguardAPI.Camera(user, camera.cameraid);

                            platform.log(camera);

                            nubicamCamera.getCameraFeed()
                                .then((feed) => {
                                    platform.log(feed);

                                    let cameraAccessory = new Accessory(camera.friendlyname, UUIDGen.generate(camera.friendlyname), hap.Accessory.Categories.CAMERA);

                                    /*cameraAccessory
                                        .getService(Service.AccessoryInformation)
                                        .setCharacteristic(Characteristic.Name, camera.friendlyname)
                                        .setCharacteristic(Characteristic.Manufacturer, "Nubicam")
                                        .setCharacteristic(Characteristic.Model, "Default-Model")
                                        .setCharacteristic(Characteristic.SerialNumber, "Default-SerialNumber");*/

                                    platform.log(cameraAccessory.services);
                                    platform.log(cameraAccessory.services[0].name);
                                    platform.log(cameraAccessory.services[0].characteristics);

                                    cameraAccessory.configureCameraSource(new FFMPEG(hap, feed, platform.log));

                                    cameraAccessories.push(cameraAccessory);
                                }).catch(reason => platform.log.error(reason));
                        });

                        platform.api.publishCameraAccessories("Nubicam", cameraAccessories)
                    }).catch(reason => platform.log.error(reason));
            })
            .catch(reason => platform.log.error(reason));
    }
};
